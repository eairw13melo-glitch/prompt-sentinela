import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ erro: "URL não fornecida" });
  }

  if (!url.includes("jw.org")) {
    return res.status(400).json({ 
      erro: "Por enquanto o Sentinela PRO só funciona com links do jw.org" 
    });
  }

  try {
    const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(url);

    const response = await axios.get(proxyUrl, {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Título
    let titulo = $("h1").first().text().trim();
    if (!titulo) {
      titulo = $("title").text().split("|")[0].trim() || "Estudo da Sentinela";
    }

    // Texto base
    let textoBase = "";
    $("p").each((i, el) => {
      const t = $(el).text().trim();
      if (t.includes("—") && t.length > 60) {
        textoBase = t;
        return false;
      }
    });

    // Parágrafos
    let paragrafos = 0;
    $("strong, p strong, .bodyPara strong").each((i, el) => {
      const t = $(el).text().trim();
      if (/^\d+(-\d+)?\.$/.test(t)) paragrafos++;
    });
    if (paragrafos === 0) {
      $("p").each((i, el) => {
        const t = $(el).text().trim();
        if (/^\d+\./.test(t)) paragrafos++;
      });
    }

    // Perguntas
    let perguntas = "";
    $("strong, p strong, .bodyPara strong").each((i, el) => {
      const t = $(el).text().trim();
      if (t.includes("?") && t.length > 20) {
        perguntas += "- " + t + "\n";
      }
    });
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
    console.error("ERRO NO EXTRAIR.JS:", error.message);
    return res.status(500).json({
      erro: "Erro ao buscar conteúdo do jw.org",
      detalhe: error.message
    });
  }
}
