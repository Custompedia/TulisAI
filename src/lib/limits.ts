// Size limits for one notebook, shared by the editor, the API and the DOCX importer.
//
// A notebook body lives in R2 (never in a D1 row), so the old 200,000-character cap that protected D1's 2 MB value
// limit is gone. What bounds a document now is the Worker: one request must fit in 128 MB of memory, and a JSON body
// costs roughly twice its size as a string (non-ASCII text makes V8 store it as UTF-16) plus about as much again as
// parsed objects. The caps below keep the worst legitimate request well under that, while still taking a thesis or
// a book of more than 2,000 A4 pages.

// Plain-text characters (documentText) in one notebook: about 2,600 A4 pages of 12 pt body text.
export const MAX_DOCUMENT_CHARACTERS = 8_000_000;
// The stored body: canonical JSON, UTF-8 bytes. A heavily formatted 8M-character document stays below it.
export const MAX_DOCUMENT_BYTES = 16_000_000;
// A request that carries a document (create, autosave, checkpoint): the decompressed JSON, and the bytes on the wire.
export const MAX_DOCUMENT_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 500_000;
export const MAX_DOCUMENT_WIRE_BYTES = MAX_DOCUMENT_REQUEST_BYTES;
// Every other JSON route keeps the small cap it always had.
export const MAX_SMALL_REQUEST_BYTES = 1_600_000;
// Objects and arrays in one JSON body, counted before JSON.parse so a body of empty braces cannot exhaust memory
// (each parsed container costs about 60 bytes). A 2,000-page thesis uses about 350,000.
export const MAX_JSON_CONTAINERS = 1_500_000;
export const MAX_JSON_DEPTH = 64;
// Editor tree shape: blocks at the top level, children of any one node, characters in one text node.
export const MAX_TOP_LEVEL_BLOCKS = 250_000;
export const MAX_CHILD_NODES = 50_000;
export const MAX_TEXT_NODE_CHARACTERS = 1_000_000;
// A .docx upload: images make up most of a long thesis file, and they are never inflated or kept.
export const MAX_DOCX_BYTES = 50_000_000;
// The parts of a .docx that are read (document, styles, numbering, notes, headers): their inflated size.
export const MAX_DOCX_PART_BYTES = 120_000_000;
export const MAX_DOCX_TOTAL_BYTES = 160_000_000;
export const MAX_DOCX_ENTRIES = 10_000;
