import { execFile } from 'node:child_process';
export function pngDataUrl(data: Buffer): string {
  if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('צילום האמולטור לא החזיר PNG תקין.');
  return `data:image/png;base64,${data.toString('base64')}`;
}
export async function captureAndroidPreview(adb: string, serial: string, env: NodeJS.ProcessEnv): Promise<string> {
  const png = await new Promise<Buffer>((resolve, reject) => {
    execFile(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { env, encoding: 'buffer', timeout: 15000, maxBuffer: 12 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  return pngDataUrl(png);
}
