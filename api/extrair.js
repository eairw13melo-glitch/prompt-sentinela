import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ erro: "URL não fornecida" });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "pt-BR,pt;q=0.9"
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // 🔎 Título
    const titulo = $("h1").first().text().trim();

    // 🔎 Texto base
    let textoBase = "";
    $("p").each((i, el) => {
      const t = $(el).text();
      if (t.includes("—")) {
        textoBase = t.trim();
        return false;
      }
    });

    // 🔎 Contar parágrafos (melhorado)
    let paragrafos = 0;
    $("p").each((i, el) => {
      const t = $(el).text().trim();
      if (/^\d+\./.test(t)) {
        paragrafos++;
      }
    });

    // 🔎 Perguntas finais
    let perguntas = "";
    $("p").each((i, el) => {
      const t = $(el).text().trim();
      if (t.includes("?")) {
        perguntas += "- " + t + "\n";
      }
    });

    return res.status(200).json({
      titulo: titulo || "Não encontrado",
      textoBase: textoBase || "Não encontrado",
      paragrafos: paragrafos || "Não identificado",
      perguntas: perguntas || "Não encontradas"
    });

  } catch (error) {
    return res.status(500).json({
      erro: "Erro ao buscar conteúdo",
      detalhe: error.message
    });
  }
}
