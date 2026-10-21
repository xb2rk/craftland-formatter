import { formatSource } from './src/format/format.ts';
import { resolveConfig } from './src/format/config.ts';
const cfg = resolveConfig({printWidth: 40});
const src = "if veryLongVariableNameA || veryLongVariableNameB || veryLongVariableNameC {\n  x = 1\n}\n";
console.log('---formatted (width 40)---');
console.log(formatSource(src, cfg));
console.log('---end---');
