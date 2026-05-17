async function buscar() {
  const link = document.getElementById("link").value.trim();

  // ✅ Verifica se digitou algo
  if (!link) {
    alert("❌ Cole um link primeiro!");
    return;
  }

  // ==================== LOADING ====================
  const btnBuscar = document.querySelector('button[onclick="buscar()"]');
  const textoOriginal = btnBuscar.textContent;
  btnBuscar.disabled = true;
  btnBuscar.innerHTML = `🔄 Buscando estudo... <span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span>`;

  try {
    const res = await fetch(`/api/extrair?url=${encodeURIComponent(link)}`);

    // Lê como texto primeiro para debug
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      alert("Erro: a API não retornou um JSON válido");
      console.log("Resposta bruta:", text);
      return;
    }

    // Erro vindo da API
    if (data.erro) {
      alert("❌ " + data.erro);
      if (data.detalhe) console.log("Detalhe:", data.detalhe);
      return;
    }

    // ✅ Monta o prompt bonito e completo
    const prompt = `
✅ PROMPT DEFINITIVO — ESTUDO DA SENTINELA PRO

🏷️ Título: ${data.titulo}
📖 Texto base: ${data.textoBase}
📄 Número de parágrafos: ${data.paragrafos}

❓ Perguntas do estudo:
${data.perguntas}
    `.trim();

    document.getElementById("resultado").textContent = prompt;

  } catch (error) {
    alert("❌ Erro ao conectar com a API. Verifique sua conexão.");
    console.error(error);
  } finally {
    // Restaura o botão
    btnBuscar.disabled = false;
    btnBuscar.textContent = textoOriginal;
  }
}

function copiar() {
  const texto = document.getElementById("resultado").textContent;

  if (!texto) {
    alert("❌ Nada para copiar! Busque um estudo primeiro.");
    return;
  }

  navigator.clipboard.writeText(texto)
    .then(() => alert("✅ Prompt copiado com sucesso!"))
    .catch(() => alert("Erro ao copiar para a área de transferência"));
}
