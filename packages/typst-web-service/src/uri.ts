export function normalizeUntitledUri(uri: string): string {
    if (!uri.startsWith("untitled:")) return uri;
    return `untitled:${uri.slice("untitled:".length).replace(/^\/+/, "")}`;
}