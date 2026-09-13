export function detectedCitations(text:string):string[] {
 return [...new Set(text.match(/(?:\([A-Z][^()\n]{0,100},\s*\d{4}[a-z]?\)|\b[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?\s*\(\d{4}[a-z]?\))/g)??[])];
}
