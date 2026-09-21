export class CsvDecoder {
  constructor(maxFieldLength = 100000) {
    this.buffer = "";
  }
  push(text) {
    this.buffer += text;
    return [];
  }
  finish() {
    return this.buffer.split("\n").map((row) => row.split(","));
  }
}
