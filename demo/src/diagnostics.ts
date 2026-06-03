import type { Diagnostic } from "@vedivad/codemirror-typst";

const SEVERITY_ICONS: Record<string, string> = {
  error: "✕",
  warning: "⚠",
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function updateDiagnostics(el: HTMLElement, diagnostics: Diagnostic[]) {
  if (diagnostics.length === 0) {
    el.innerHTML = `<h2>Diagnostics</h2><p class="empty">No issues found.</p>`;
    return;
  }
  const items = diagnostics
    .map((d) => {
      const loc = d.location
        ? escapeHtml(
            `${d.location.file}:${d.location.line}:${d.location.column}`,
          )
        : "";
      const icon = SEVERITY_ICONS[d.severity] ?? "ℹ";
      return `<li class="diagnostic ${d.severity}"><span class="icon">${icon}</span><span class="loc">${loc}</span><span class="message">${escapeHtml(d.message)}</span></li>`;
    })
    .join("");
  el.innerHTML = `<h2>Diagnostics <span class="count">${diagnostics.length}</span></h2><ul>${items}</ul>`;
}
