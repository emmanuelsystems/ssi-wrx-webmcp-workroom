const SOURCE_DB_NAME = "ssi-wrx-workroom-sources";
const SOURCE_STORE_NAME = "sources";
export const MAX_SOURCE_FILES = 10;
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
export const SOURCE_TEXT_LIMIT = 80_000;

const SUPPORTED_EXTENSIONS = new Map([
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["pdf", "application/pdf"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

function extensionOf(fileName = "") {
  return fileName.toLowerCase().split(".").pop();
}

function cleanText(text) {
  return String(text ?? "").replaceAll("\0", "").replace(/\r\n?/g, "\n").trim();
}

export function validateSourceManifest(sources = []) {
  if (!Array.isArray(sources)) return { valid: false, error: "Sources must be an array." };
  if (sources.length > MAX_SOURCE_FILES) return { valid: false, error: `A maximum of ${MAX_SOURCE_FILES} sources is allowed.` };
  const ids = new Set();
  for (const source of sources) {
    if (!source || typeof source !== "object") return { valid: false, error: "Source metadata must be objects." };
    if (typeof source.sourceId !== "string" || !source.sourceId.trim() || ids.has(source.sourceId)) return { valid: false, error: "Source ids must be present and unique." };
    if (typeof source.fileName !== "string" || !source.fileName.trim()) return { valid: false, error: "Source file names are required." };
    if (!SUPPORTED_EXTENSIONS.has(extensionOf(source.fileName))) return { valid: false, error: `Unsupported source type: ${source.fileName}.` };
    if (!Number.isInteger(source.size) || source.size < 0 || source.size > MAX_SOURCE_FILE_BYTES) return { valid: false, error: `Source ${source.fileName} exceeds the 10 MB limit.` };
    if (source.extractionStatus !== "extracted" || !Number.isInteger(source.charCount) || source.charCount <= 0) return { valid: false, error: `Source ${source.fileName} has not produced extractable text.` };
    ids.add(source.sourceId);
  }
  return { valid: true };
}

export function validateSourceReferences(sourceIds = [], sources = []) {
  if (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== "string" || !id.trim())) return { valid: false, error: "Source references must be non-empty ids." };
  const knownIds = new Set(sources.map((source) => source.sourceId));
  if (sourceIds.some((id) => !knownIds.has(id))) return { valid: false, error: "A work node references an unknown source." };
  return { valid: true };
}

export async function extractSourceFile(file) {
  const extension = extensionOf(file?.name);
  if (!file || !SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported source type: ${file?.name ?? "Unknown file"}.`);
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error(`${file.name} exceeds the 10 MB limit.`);
  const original = await file.arrayBuffer();
  let text;
  try {
    if (extension === "txt" || extension === "md") {
      text = new TextDecoder().decode(original);
    } else if (extension === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document = await getDocument({ data: original.slice(0), disableWorker: true }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str ?? "").join(" "));
      }
      text = pages.join("\n\n");
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: original.slice(0), buffer: new Uint8Array(original.slice(0)) });
      text = result.value;
    }
  } catch (error) {
    if (error?.name === "PasswordException" || /password|encrypted/i.test(error?.message ?? "")) throw new Error(`${file.name} is password-protected.`);
    throw new Error(`${file.name} could not be extracted. It may be corrupted, image-only, or unextractable.`);
  }
  const clean = cleanText(text);
  if (!clean) throw new Error(`${file.name} contains no extractable text. Image-only or empty files are not supported.`);
  const sourceId = `source-${crypto.randomUUID()}`;
  return {
    sourceId,
    fileName: file.name,
    fileType: file.type || SUPPORTED_EXTENSIONS.get(extension),
    extension,
    size: file.size,
    extractionStatus: "extracted",
    charCount: clean.length,
    createdAt: new Date().toISOString(),
    text: clean,
    original,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SOURCE_STORE_NAME, { keyPath: "sourceId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveEpisodeSources(sources = [], episodeId) {
  if (!sources.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    for (const source of sources) transaction.objectStore(SOURCE_STORE_NAME).put({ ...source, episodeId });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function getEpisodeSource(sourceId) {
  const database = await openDatabase();
  const source = await new Promise((resolve, reject) => {
    const request = database.transaction(SOURCE_STORE_NAME).objectStore(SOURCE_STORE_NAME).get(sourceId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return source;
}

export async function deleteEpisodeSources(episodeId) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(SOURCE_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.episodeId === episodeId) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function prepareSourceContext(sources = []) {
  const summaries = sources.map((source) => {
    const text = cleanText(source.text);
    const bounded = text.length > SOURCE_TEXT_LIMIT ? `${text.slice(0, SOURCE_TEXT_LIMIT)}\n[Source text truncated for analysis; full text remains local.]` : text;
    return {
      sourceId: source.sourceId,
      fileName: source.fileName,
      fileType: source.fileType,
      charCount: text.length,
      text: bounded,
      summary: text.slice(0, 1200),
    };
  });
  return {
    sourceCount: summaries.length,
    summaries,
    combinedContext: summaries.map((source) => `SOURCE ${source.sourceId} · ${source.fileName}\n${source.text}`).join("\n\n---\n\n"),
  };
}

export function sourceManifestFromRecords(records = []) {
  return records.map(({ text: _text, original: _original, ...metadata }) => metadata);
}
