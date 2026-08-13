import fs from "node:fs";
import path from "node:path";

const root = path.resolve("public", "models", "obstacles");
const texture = fs.readFileSync(path.join(root, "Textures", "colormap.png"));
const vehicleFiles = ["sedan.glb", "suv.glb", "pickup.glb", "van.glb", "truck.glb"];
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const align4 = (value) => (value + 3) & ~3;

function chunksOf(file) {
  const chunks = [];
  let offset = 12;
  while (offset < file.length) {
    const length = file.readUInt32LE(offset);
    chunks.push({ type: file.readUInt32LE(offset + 4), data: file.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  return chunks;
}

for (const name of vehicleFiles) {
  const filePath = path.join(root, name);
  const file = fs.readFileSync(filePath);
  const chunks = chunksOf(file);
  const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK);
  const binChunk = chunks.find((chunk) => chunk.type === BIN_CHUNK);
  if (!jsonChunk || !binChunk) throw new Error(`${name}: invalid GLB chunks`);

  const json = JSON.parse(jsonChunk.data.toString("utf8").replace(/[\0 ]+$/, ""));
  const image = json.images?.find((item) => item.uri === "Textures/colormap.png");
  if (!image) {
    console.log(`${name}: texture is already embedded`);
    continue;
  }

  const originalLength = json.buffers[0].byteLength;
  const imageOffset = align4(originalLength);
  const logicalBinLength = imageOffset + texture.length;
  const paddedBinLength = align4(logicalBinLength);
  const binary = Buffer.alloc(paddedBinLength);
  binChunk.data.copy(binary, 0, 0, originalLength);
  texture.copy(binary, imageOffset);

  const imageView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: imageOffset, byteLength: texture.length });
  delete image.uri;
  image.bufferView = imageView;
  image.mimeType = "image/png";
  json.buffers[0].byteLength = logicalBinLength;

  const encodedJson = Buffer.from(JSON.stringify(json));
  const paddedJsonLength = align4(encodedJson.length);
  const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
  encodedJson.copy(paddedJson);
  const totalLength = 12 + 8 + paddedJson.length + 8 + binary.length;
  const output = Buffer.alloc(totalLength);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  paddedJson.copy(output, 20);
  const binHeader = 20 + paddedJson.length;
  output.writeUInt32LE(binary.length, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  binary.copy(output, binHeader + 8);
  fs.writeFileSync(filePath, output);
  console.log(`${name}: embedded ${texture.length} texture bytes`);
}
