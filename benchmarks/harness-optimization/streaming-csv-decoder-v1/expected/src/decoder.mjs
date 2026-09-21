export class CsvDecoder {
  #limit;
  #mode = "start";
  #field = "";
  #row = [];
  #active = false;
  #cr = false;
  #closed = false;
  constructor(maxFieldLength = 100000) {
    if (
      !Number.isSafeInteger(maxFieldLength) ||
      maxFieldLength < 0 ||
      maxFieldLength > 1000000
    )
      throw new TypeError("Invalid field limit");
    this.#limit = maxFieldLength;
  }
  #append(c) {
    this.#field += c;
    if (this.#field.length > this.#limit) throw new TypeError("Field too long");
  }
  #endField() {
    this.#row.push(this.#field);
    this.#field = "";
    this.#mode = "start";
  }
  #endRow(out) {
    this.#endField();
    out.push(this.#row);
    this.#row = [];
    this.#active = false;
  }
  push(text) {
    if (this.#closed) throw new TypeError("Decoder closed");
    try {
      if (typeof text !== "string") throw new TypeError("Invalid chunk");
      const out = [];
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (this.#cr) {
          this.#cr = false;
          if (c === "\n") continue;
        }
        if (this.#mode === "quoted") {
          if (c === '"') this.#mode = "after";
          else this.#append(c);
          continue;
        }
        if (this.#mode === "after" && c === '"') {
          this.#append('"');
          this.#mode = "quoted";
          continue;
        }
        if (c === ",") {
          this.#endField();
          this.#active = true;
          continue;
        }
        if (c === "\r" || c === "\n") {
          this.#endRow(out);
          this.#cr = c === "\r";
          continue;
        }
        if (this.#mode === "after") throw new TypeError("After closing quote");
        this.#active = true;
        if (c === '"') {
          if (this.#mode !== "start")
            throw new TypeError("Quote in unquoted field");
          this.#mode = "quoted";
        } else {
          this.#mode = "unquoted";
          this.#append(c);
        }
      }
      return out;
    } catch (error) {
      this.#closed = true;
      throw error;
    }
  }
  finish() {
    if (this.#closed) throw new TypeError("Decoder closed");
    this.#closed = true;
    if (this.#mode === "quoted") throw new TypeError("Unterminated quote");
    const out = [];
    if (this.#active || this.#row.length) this.#endRow(out);
    return out;
  }
}
