async function buscar() {
  const link = document.getElementById("link").value;

  const res = await fetch(`/api/extrair?url=${encodeURIComponent(link)}`);
  const data = await res.json();

  if (data.erro) {
    alert("Erro: " + data.erro);
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
