import axios from "axios";
import cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;

  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // 🔎 Título
    const titulo = $("h1").first().text().trim();

    // 🔎 Texto base
    const textoBase = $("p strong").first().text().trim();

    // 🔎 Parágrafos (contagem)
    const paragrafos = $("p").length;

    // 🔎 Perguntas finais (tentativa)
    let perguntas = "";
    $("p").each((i, el) => {
      const text = $(el).text();
      if (text.includes("?")) {
        perguntas += text + "\n";
      }
    });

    res.status(200).json({
      titulo,
      textoBase,
      paragrafos,
      perguntas
    });

  } catch (err) {
    res.status(500).json({ erro: "Falha ao buscar dados" });
  }
}