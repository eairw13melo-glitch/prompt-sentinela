# JW Vídeo → Texto v1.1

Aplicativo Windows para extrair o texto de **legendas oficiais públicas** associadas a vídeos de páginas do JW.ORG e WOL.

## Gerar o `.exe` pelo GitHub Actions

O repositório já contém o workflow:

`.github/workflows/build-windows-exe.yml`

### Passo a passo

1. Crie um repositório novo no GitHub.
2. Envie **todo o conteúdo desta pasta**, inclusive a pasta oculta `.github`.
3. Abra a aba **Actions** do repositório.
4. Selecione **Compilar JW Video Texto EXE**.
5. Clique em **Run workflow** e confirme.
6. Quando a execução terminar com um ícone verde, abra essa execução.
7. Na seção **Artifacts**, baixe **JW-Video-Texto-Windows**.
8. Extraia o ZIP baixado pelo GitHub. Dentro dele estarão:
   - `JW-Video-Texto.exe`
   - `JW-Video-Texto.sha256.txt`

O workflow também recompila automaticamente quando houver alterações no programa enviadas para as branches `main` ou `master`.

## Como usar o aplicativo

1. Abra `JW-Video-Texto.exe`.
2. Cole um link público de vídeo/página do `jw.org` ou `wol.jw.org`.
3. Clique em **Analisar**.
4. Escolha a faixa de legenda encontrada.
5. Clique em **Extrair texto**.
6. Copie ou salve o resultado em TXT.

## Recursos

- Interface gráfica Windows com Tkinter.
- Links limitados a JW.ORG/WOL.
- Detecção de VTT direto na página.
- Consulta ao catálogo público de mídia JW quando IDs de mídia são encontrados.
- Conversão de WebVTT em texto limpo UTF-8.
- Copiar e salvar TXT.
- Histórico local.
- BKP Exportar/Importar do histórico com prevenção de duplicidade.
- Diagnóstico quando não houver legenda disponível.

## Limitação atual

A v1.1 extrai **legendas públicas existentes**. Ela ainda não faz reconhecimento de fala do áudio quando o vídeo não possui legenda disponível.

## Dados locais

O histórico é salvo em:

`%APPDATA%\JWVideoTexto\history.json`

## Segurança

O programa não pede login, senha, cookies ou credenciais JW. Trabalha apenas com conteúdo público acessível pelo link fornecido.
