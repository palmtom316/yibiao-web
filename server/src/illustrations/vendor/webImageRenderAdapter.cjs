// Adapter for the pinned upstream generator. Only trusted DOM probes execute;
// model HTML stays script-disabled, offline and confined to a fresh browser.
const HTML_DESIGN_WIDTH = 1240;
const HTML_MAX_DESIGN_HEIGHT = 1800;
const HTML_CAPTURE_SCALE = 2;
function getLocalImageRenderService() {
  let cachedHtml;
  let cachedResult;
  async function htmlResult(html) {
    if (html !== cachedHtml || !cachedResult) {
      const { renderLocalDiagramDetailed } = await import('../render.ts');
      cachedResult = await renderLocalDiagramDetailed('html', html, HTML_DESIGN_WIDTH, HTML_MAX_DESIGN_HEIGHT, HTML_CAPTURE_SCALE);
      cachedHtml = html;
    }
    return cachedResult;
  }
  return {
    renderHtmlToPng: htmlResult,
    probeHtmlLayoutOnly: htmlResult,
    async renderMermaidToPng(code) {
      const { renderLocalDiagramDetailed } = await import('../render.ts');
      return renderLocalDiagramDetailed('mermaid', code, HTML_DESIGN_WIDTH, HTML_MAX_DESIGN_HEIGHT, HTML_CAPTURE_SCALE);
    },
  };
}
module.exports = { HTML_DESIGN_WIDTH, HTML_MAX_DESIGN_HEIGHT, HTML_CAPTURE_SCALE, getLocalImageRenderService };
