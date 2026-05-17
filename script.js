async function buscar() {
  const link = document.getElementById("link").value;

  const res = await fetch("/api/extrair?url=" + encodeURIComponent(link));
  const data = await res.json();

  const prompt = `
✅ PROMPT DEFINITIVO — ESTUDO DA SENTINELA

🏷️ Título: ${data.titulo}
📖 Texto base: ${data.textoBase}
📄 Parágrafos: ${data.paragrafos}

❓ Perguntas finais:
${data.perguntas}

----------------------------------------

🎭 PAPEL:
Ancião experiente, empático e pastoral

🎯 OBJETIVO:
Unir verdade bíblica + amor + aplicação

🧱 ESTRUTURA:
1️⃣ Análise
2️⃣ Comentário
3️⃣ Aplicação

🔥 FINAL:
Fortalecer fé e edificar
`;

  document.getElementById("resultado").textContent = prompt;
}

function copiar() {
  const texto = document.getElementById("resultado").textContent;
  navigator.clipboard.writeText(texto);
}