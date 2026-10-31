import { describe, expect, it } from 'vitest';
import { parseComposePreview, previewText } from '../composePreview';
const parse = (body: string) => parseComposePreview(`@Composable fun Login() { ${body} }`, 'Login');
describe('fast Compose preview', () => {
  it('preserves nesting, arguments, Hebrew strings and initial state', () => {
    const d = parse('var email by remember { mutableStateOf("hello") }; Column(modifier = Modifier.fillMaxSize().padding(24.dp)) { Text("שלום, עולם") OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("אימייל") }) Button(onClick = { email = "other" }) { Text("המשך") } }');
    expect(d.nodes[0].children.map(n => n.kind)).toEqual(['Text', 'OutlinedTextField', 'Button']);
    expect(previewText(d.nodes[0].children[0].args['0'], d.values)).toBe('שלום, עולם');
    expect(previewText(d.nodes[0].children[1].args.value, d.values)).toBe('hello');
    expect(d.nodes[0].children[2].children[0].args['0']).toBe('"המשך"');
  });
  it('ignores comments and selects only the requested function', () => {
    const d = parseComposePreview('fun Other() { Text("wrong") } fun Login() { // Text("comment")\n Text("right } , (") }', 'Login');
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0].args['0']).toBe('"right } , ("');
  });
  it('supports parameterless layouts and empty state', () => {
    expect(parse('Column { Row { Text("a") } }').nodes[0].children[0].kind).toBe('Row');
    expect(parse('').nodes).toEqual([]);
  });
  it('reports incomplete edits and unsupported components', () => {
    expect(() => parse('Column( {')).toThrow('סוגריים');
    expect(parse('CameraPreview()').warnings[0]).toContain('CameraPreview');
  });
  it('does not execute callbacks and does not render callback content', () => {
    const d = parse('Button(onClick = { Text("not visible") }) { Text("visible") }');
    expect(d.nodes[0].children).toHaveLength(1);
    expect(d.nodes[0].children[0].args['0']).toBe('"visible"');
  });
});
