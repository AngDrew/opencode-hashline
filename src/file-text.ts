export interface FileTextEnvelope {
  content: string
  hadBom: boolean
  lineEnding: "\n" | "\r\n"
}

export function canonicalizeFileText(raw: string): FileTextEnvelope {
  let content = raw
  const hadBom = content.charCodeAt(0) === 0xfeff
  if (hadBom) content = content.slice(1)
  const lineEnding: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n"
  if (lineEnding === "\r\n") content = content.replace(/\r\n/g, "\n")
  return { content, hadBom, lineEnding }
}

export function restoreFileText(
  canonicalContent: string,
  envelope: FileTextEnvelope,
): string {
  let result = canonicalContent
  if (envelope.lineEnding === "\r\n") result = result.replace(/\n/g, "\r\n")
  if (envelope.hadBom) result = "\ufeff" + result
  return result
}
