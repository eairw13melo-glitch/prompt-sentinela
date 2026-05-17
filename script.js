async function buscar() {
  const link = document.getElementById("link").value;

  // ✅ Verifica se digitou algo
  if (!link) {
    alert("Cole um link primeiro!");
    return;
  }

  try {
    const res = await fetch(`/api/extrair?url=${encodeURIComponent(link)}`);

    // ✅ Lê como TEXTO primeiro (evita erro JSON)
    const text = await res.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (err) {
      alert("Erro: resposta inválida da API");
      console.log("Resposta recebida:", text);
      return;
    }

    // ✅ Se a API retornar erro
    if (data.erro) {
      alert("Erro: " + data.erro);
      console.log("Detalhe:", data.detalhe);
      return;
    }

    const prompt = `
✅ PROMPT DEFINITIVO — ESTUDO DA SENTINELA

🏷️ Título: ${data.titulo}
📖 Texto base: ${data.textoBase}
📄 Parágrafos: ${data.paragrafos}

❓ Perguntas:
${data.perguntas}
`;

    document.getElementById("resultado").textContent = prompt;

  } catch (error) {
    alert("Erro ao conectar com a API");
    console.error(error);
  }
}

function copiar() {
  const texto = document.getElementById("resultado").textContent;

  if (!texto) {
    alert("Nada para copiar!");
    return;
  }

  navigator.clipboard.writeText(texto)
    .then(() => alert("✅ Prompt copiado!"))
    .catch(() => alert("Erro ao copiar"));
}
