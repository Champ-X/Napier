export function encodeCursor(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
export function decodeCursor(token){return JSON.parse(Buffer.from(token,'base64url').toString('utf8'));}
