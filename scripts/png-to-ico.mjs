import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'build/icon.png');
const outputPath = path.resolve(process.argv[3] ?? 'build/icon.ico');
const png = readFileSync(inputPath);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

writeFileSync(outputPath, Buffer.concat([header, entry, png]));
