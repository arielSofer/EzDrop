// CheckpointStore + ComponentLibrary against an in-memory FileSystem: the
// Application Support layout, the `<ISO8601>__<label>.json` naming, the
// 40-checkpoint cap, and the component template normalisation.

import { afterEach, describe, expect, it } from 'vitest';
import { makeDesignNode, makeNodeLogicBinding, makeNodeStyle, type DesignNode } from '../../models/DesignNode';
import { makeDesignPage, makeDesignProject, type DesignProject } from '../../models/DesignProject';
import { newUUID } from '../../models/uuid';
import { ManualClock } from '../../platform/Clock';
import { MemoryFileSystem, type FileStat } from '../../platform/FileSystem';
import { resetPlatform, setPlatform } from '../../platform/platform';
import { CheckpointStore, maxCheckpointsPerProject } from '../CheckpointStore';
import { ComponentLibrary } from '../ComponentLibrary';
import type { GitSyncHook } from '../themeHosts';

/** MemoryFileSystem stamps `Date.now()`; checkpoints sort by mtime, so record it. */
class StampedMemoryFileSystem extends MemoryFileSystem {
  private times = new Map<string, number>();
  private tick = 0;

  override async writeText(path: string, text: string): Promise<void> {
    await super.writeText(path, text);
    this.tick += 1;
    this.times.set(this.join(path), this.tick);
  }

  override async stat(path: string): Promise<FileStat | null> {
    const stat = await super.stat(path);
    if (stat === null) return null;
    const recorded = this.times.get(this.join(path));
    return recorded === undefined ? stat : { ...stat, modifiedAt: recorded };
  }
}

function project(name: string): DesignProject {
  return makeDesignProject({
    name,
    pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [] })],
  });
}

afterEach(() => {
  resetPlatform();
});

describe('CheckpointStore', () => {
  it('writes <ISO8601>__<label>.json under Checkpoints/<project> and notifies git sync', async () => {
    const fs = new StampedMemoryFileSystem();
    const clock = new ManualClock(Date.UTC(2026, 8, 4, 9, 30, 0));
    setPlatform({ fileSystem: fs, clock });
    const recorded: { name: string; label: string }[] = [];
    const git: GitSyncHook = {
      recordCheckpoint(p, label) {
        recorded.push({ name: p.name, label });
      },
    };

    const checkpoint = await CheckpointStore.save(project('Aroma'), 'before: build/run', { fs, git });
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.label).toBe('before: build-run');
    expect(checkpoint!.id).toBe(
      '/home/Library/Application Support/AgenticDesigner/Checkpoints/Aroma/2026-09-04T09-30-00Z__before: build-run.json',
    );
    expect(recorded).toEqual([{ name: 'Aroma', label: 'before: build-run' }]);

    const listed = await CheckpointStore.list('Aroma', fs);
    expect(listed.map((c) => c.label)).toEqual(['before: build-run']);
    const restored = await CheckpointStore.load(listed[0]!, fs);
    expect(restored.name).toBe('Aroma');
    expect(restored.pages).toHaveLength(1);
  });

  it('sanitises the project directory name', async () => {
    const fs = new StampedMemoryFileSystem();
    setPlatform({ fileSystem: fs, clock: new ManualClock(0) });
    expect(CheckpointStore.directory('a/b:c', fs)).toBe(
      '/home/Library/Application Support/AgenticDesigner/Checkpoints/a-b-c',
    );
    expect(CheckpointStore.directory('', fs)).toBe(
      '/home/Library/Application Support/AgenticDesigner/Checkpoints/Untitled',
    );
  });

  it('truncates the label to 60 characters', async () => {
    const fs = new StampedMemoryFileSystem();
    setPlatform({ fileSystem: fs, clock: new ManualClock(Date.UTC(2026, 0, 1)) });
    const long = 'x'.repeat(80);
    const checkpoint = await CheckpointStore.save(project('Aroma'), long, { fs });
    expect(checkpoint!.label).toBe('x'.repeat(60));
  });

  it('prunes to the 40 newest checkpoints', async () => {
    const fs = new StampedMemoryFileSystem();
    const clock = new ManualClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    setPlatform({ fileSystem: fs, clock });
    for (let i = 0; i < 45; i += 1) {
      await CheckpointStore.save(project('Aroma'), `run ${i}`, { fs });
      clock.advance(60_000);
    }
    const listed = await CheckpointStore.list('Aroma', fs);
    expect(listed).toHaveLength(maxCheckpointsPerProject);
    expect(listed[0]!.label).toBe('run 44');
    expect(listed[listed.length - 1]!.label).toBe('run 5');
  });

  it('returns undefined (and never throws) when the write fails', async () => {
    const fs = new StampedMemoryFileSystem();
    setPlatform({ fileSystem: fs, clock: new ManualClock(0) });
    const broken = Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, {
      mkdirp: () => Promise.reject(new Error('read-only volume')),
    });
    expect(await CheckpointStore.save(project('Aroma'), 'label', { fs: broken })).toBeUndefined();
  });
});

describe('ComponentLibrary', () => {
  function card(): DesignNode {
    const label = makeDesignNode({
      type: 'Text', name: 'Label', x: 12, y: 12, width: 100, height: 20, text: 'Total',
      style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, textColor: '#111111' }),
    });
    label.logicBindings = [makeNodeLogicBinding({ kind: 'text', variableName: 'total' })];
    const node = makeDesignNode({
      type: 'Frame', name: 'Balance Card', x: 40, y: 120, width: 300, height: 160,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 16, opacity: 1 }),
      children: [label],
    });
    node.logicBindings = [makeNodeLogicBinding({ kind: 'visibility', variableName: 'isLoaded' })];
    return node;
  }

  it('stores a template with no bindings at the origin, one file per component', async () => {
    const fs = new MemoryFileSystem();
    const clock = new ManualClock(Date.UTC(2026, 8, 4, 12, 0, 0));
    setPlatform({ fileSystem: fs, clock });

    const saved = await ComponentLibrary.save(card(), '  Balance Card  ', 'Finance', fs);
    expect(saved.name).toBe('Balance Card');
    expect(saved.category).toBe('Finance');
    expect(saved.node.x).toBe(0);
    expect(saved.node.y).toBe(0);
    expect(saved.node.logicBindings).toBeUndefined();
    expect(saved.node.children[0]!.logicBindings).toBeUndefined();

    const path = `/home/Library/Application Support/AgenticDesigner/Components/${saved.id}.json`;
    expect(await fs.exists(path)).toBe(true);
    const raw = JSON.parse(await fs.readText(path));
    expect(raw.createdAt).toBe('2026-09-04T12:00:00Z');
    expect(Object.keys(raw)).toEqual(['category', 'createdAt', 'id', 'name', 'node']); // sortedKeys

    // The saved copy never mutates the node on the canvas.
    const original = card();
    await ComponentLibrary.save(original, 'Copy', 'General', fs);
    expect(original.x).toBe(40);
    expect(original.logicBindings).toHaveLength(1);
  });

  it('lists newest first and instantiates with fresh ids at a point', async () => {
    const fs = new MemoryFileSystem();
    const clock = new ManualClock(Date.UTC(2026, 8, 4, 12, 0, 0));
    setPlatform({ fileSystem: fs, clock });

    const first = await ComponentLibrary.save(card(), 'First', 'General', fs);
    clock.advance(60_000);
    const second = await ComponentLibrary.save(card(), 'Second', 'General', fs);

    const all = await ComponentLibrary.all(fs);
    expect(all.map((c) => c.name)).toEqual(['Second', 'First']);

    const instance = ComponentLibrary.instantiate(all[0]!, { x: 200, y: 80 });
    expect(instance.x).toBe(200);
    expect(instance.y).toBe(80);
    expect(instance.id).not.toBe(second.node.id);
    expect(instance.children[0]!.id).not.toBe(second.node.children[0]!.id);
    // A second instance shares no id with the first.
    const other = ComponentLibrary.instantiate(all[0]!, { x: 0, y: 0 });
    expect(other.id).not.toBe(instance.id);

    await ComponentLibrary.delete(first, fs);
    expect((await ComponentLibrary.all(fs)).map((c) => c.name)).toEqual(['Second']);
  });

  it('returns an empty library when the directory does not exist', async () => {
    const fs = new MemoryFileSystem();
    setPlatform({ fileSystem: fs, clock: new ManualClock(0) });
    expect(await ComponentLibrary.all(fs)).toEqual([]);
  });
});
