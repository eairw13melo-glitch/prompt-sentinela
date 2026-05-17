import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ erro: "URL não fornecida" });
  }

  // Validação para aceitar apenas links do jw.org por enquanto
  if (!url.includes("jw.org")) {
    return res.status(400).json({ 
      erro: "Por enquanto o Sentinela PRO só funciona com links do site jw.org" 
    });
  }

  try {
    // Proxy estável + cabeçalhos para evitar bloqueio
    const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(url);

    const response = await axios.get(proxyUrl, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // ==================== TÍTULO ====================
    let titulo = $("h1").first().text().trim();
    if (!titulo) {
      titulo = $("title").text().split("|")[0].trim() || "Estudo da Sentinela";
    }

    // ==================== TEXTO BASE (citação inicial) ====================
    let textoBase = "";
    $("p").each((i, el) => {
      const t = $(el).text().trim();
      if (t.includes("—") && (t.includes("“") || t.includes("*") || t.length > 80)) {
        textoBase = t;
        return false; // para no primeiro encontrado
      }
    });

    // ==================== NÚMERO DE PARÁGRAFOS ====================
    let paragrafos = 0;
    $("strong, p strong, .bodyPara strong").each((i, el) => {
      const t = $(el).text().trim();
      if (/^\d+(-\d+)?\.$/.test(t)) {
        paragrafos++;
      }
    });

    // Fallback caso não encontre pelos strong
    if (paragrafos === 0) {
      $("p").each((i, el) => {
        const t = $(el).text().trim();
        if (/^\d+\./.test(t)) {
          paragrafos++;
        }
      });
    }

    // ==================== PERGUNTAS DO ESTUDO ====================
    let perguntas = "";
    $("strong, p strong, .bodyPara strong").each((i, el) => {
      const t = $(el).text().trim();
      if (t.includes("?") && t.length > 20) {
        perguntas += "- " + t + "\n";
      }
    });

    // Fallback caso não encontre perguntas nos strong
    if (!perguntas.trim()) {
      $("p").each((i, el) => {
        const t = $(el).text().trim();
        if (t.includes("?") && t.length > 30) {
          perguntas += "- " + t + "\n";
        }
      });
    }

    return res.status(200).json({
      titulo: titulo || "Não encontrado",
      textoBase: textoBase || "Não encontrado",
      paragrafos: paragrafos || 0,
      perguntas: perguntas.trim() || "Não encontradas"
    });

  } catch (error) {
    console.error("ERRO REAL no extrair.js:", error.message);
    return res.status(500).json({
      erro: "Erro ao buscar conteúdo do jw.org",
      detalhe: error.message
    });
  }
}
