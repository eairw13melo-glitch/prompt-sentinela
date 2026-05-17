import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ erro: "URL não fornecida" });
  }

  try {
    const response = await axios.get(url);
    const html = response.data;

    const $ = cheerio.load(html);

    // 🔎 Título
    const titulo = $("h1").first().text().trim();

    // 🔎 Texto base (geralmente contém travessão)
    let textoBase = "";
    $("p").each((i, el) => {
      const t = $(el).text();
      if (t.includes("—")) {
        textoBase = t;
        return false;
      }
    });

    // 🔎 Contar parágrafos (aproximação)
    const paragrafos = $("p").length;

    // 🔎 Perguntas finais
    let perguntas = "";
    $("p").each((i, el) => {
      const t = $(el).text();
      if (t.includes("?")) {
        perguntas += "- " + t + "\n";
      }
    });

    return res.status(200).json({
      titulo,
      textoBase,
      paragrafos,
      perguntas
    });

  } catch (error) {
    return res.status(500).json({
      erro: "Erro ao buscar conteúdo",
      detalhe: error.message
    });
  }
}
