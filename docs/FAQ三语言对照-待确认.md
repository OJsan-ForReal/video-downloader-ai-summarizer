# FAQ三语言对照（待你确认，确认后转JSON）

> 中文是之前已经确认的定稿内容，英语/葡萄牙语是这次新翻译的，请你检查一下：
> 1. 问题本身有没有需要增删的
> 2. 翻译的语气/风格是不是你想要的（比如要不要更口语化，还是保持现在这种简洁客服风格）

---

## 分类：通用 / General / Geral

### 1
**中**：这个网站是做什么的？
一个视频下载工具，支持YouTube、Bilibili等1800+平台，可以下载视频/音频，还能用AI生成视频内容摘要、思维导图，以及针对视频内容提问。

**EN**：What is this website?
A video downloader supporting YouTube, Bilibili, and 1800+ other platforms — download video or audio, and use AI to generate video summaries, mind maps, and ask questions about the video's content.

**PT**：O que é este site?
Uma ferramenta de download de vídeos que suporta o YouTube, o Bilibili e mais de 1800 outras plataformas — descarregue vídeo ou áudio, e use IA para gerar resumos, mapas mentais e fazer perguntas sobre o conteúdo do vídeo.

### 2
**中**：需要注册账号才能用吗？
下载功能不需要注册；AI总结/问答功能需要登录账号（免费账号每天3次额度）。

**EN**：Do I need an account to use this?
No account is needed for downloading. AI summary/chat features require a login (free accounts get 3 uses per day).

**PT**：Preciso de criar uma conta para usar isto?
Não é necessária conta para descarregar. As funcionalidades de resumo/chat com IA exigem login (contas gratuitas têm 3 utilizações por dia).

### 3
**中**：支持哪些平台？
YouTube、Bilibili、Twitter(X)等1800+平台，基于开源的yt-dlp项目。

**EN**：Which platforms are supported?
YouTube, Bilibili, Twitter(X), and 1800+ other platforms, powered by the open-source yt-dlp project.

**PT**：Que plataformas são suportadas?
YouTube, Bilibili, Twitter(X) e mais de 1800 outras plataformas, com base no projeto open-source yt-dlp.

### 4
**中**：下载的文件在哪里？
浏览器默认下载目录，具体位置因浏览器设置而异。

**EN**：Where do downloaded files go?
Your browser's default download folder — the exact location depends on your browser settings.

**PT**：Onde ficam os ficheiros descarregados?
Na pasta de downloads padrão do seu navegador — a localização exata depende das configurações do navegador.

### 5
**中**：我的数据会被保留吗？是匿名的吗？
不会。字幕/语音转录用的临时文件处理完立刻删除；下载的视频文件在发送给你之后也会立刻清理，不会长期留存在服务器上。

**EN**：Is my data retained? Is it anonymous?
No. Temporary files used for subtitle/transcription processing are deleted immediately after use; downloaded video files are also deleted right after being sent to you — nothing is kept on our server long-term.

**PT**：Os meus dados são guardados? É anónimo?
Não. Os ficheiros temporários usados para processar legendas/transcrição são eliminados imediatamente após o uso; os ficheiros de vídeo descarregados também são eliminados logo após serem enviados a si — nada fica guardado no nosso servidor a longo prazo.

---

## 分类：AI功能 / AI Features / Funcionalidades de IA

### 6
**中**：AI总结是怎么工作的？
提取视频字幕（平台自带或AI语音转录），用大语言模型生成内容概述、分段大纲、核心要点。

**EN**：How does AI summarization work?
It extracts the video's subtitles (either the platform's own captions or AI speech transcription), then uses a large language model to generate an overview, section-by-section outline, and key takeaways.

**PT**：Como funciona o resumo por IA?
Extrai as legendas do vídeo (legendas próprias da plataforma ou transcrição por IA), e usa um modelo de linguagem de grande escala para gerar uma visão geral, um esquema por secções e os pontos principais.

### 7
**中**：如果视频没有字幕会怎样？
会自动用AI语音识别（Whisper）转录音频兜底；如果视频时长超过转录额度上限，或转录服务暂时不可用，会提示对应的错误信息，无法生成总结。

**EN**：What happens if a video has no subtitles?
It automatically falls back to AI speech recognition (Whisper) to transcribe the audio. If the video exceeds the transcription time limit, or the transcription service is temporarily unavailable, you'll see an error message and no summary will be generated.

**PT**：O que acontece se um vídeo não tiver legendas?
O sistema recorre automaticamente ao reconhecimento de voz por IA (Whisper) para transcrever o áudio. Se o vídeo exceder o limite de duração para transcrição, ou se o serviço de transcrição estiver temporariamente indisponível, será apresentada uma mensagem de erro e o resumo não será gerado.

### 8
**中**：字幕/AI总结支持哪些语言的视频？
理论上支持多语言，但中文、英文、葡萄牙语的识别准确度最高，推荐优先使用这三种语言的视频。

**EN**：Which video languages does subtitle/AI summarization support?
It supports multiple languages in theory, but Chinese, English, and Portuguese give the most accurate results — we recommend using videos in one of these three languages.

**PT**：Que idiomas de vídeo são suportados pelas legendas/resumo por IA?
Em teoria suporta vários idiomas, mas o chinês, o inglês e o português têm a maior precisão de reconhecimento — recomendamos usar vídeos num destes três idiomas.

### 9
**中**：AI问答支持哪些语言？
跟随你提问所使用的语言回答，不限定必须用中文或英文提问。

**EN**：What languages does the AI chat support?
It replies in whatever language you ask your question in — you're not limited to Chinese or English.

**PT**：Que idiomas são suportados no chat com IA?
Responde no mesmo idioma em que fizer a pergunta — não está limitado a chinês ou inglês.

### 10
**中**：什么样的视频没法用AI总结？
完全没有字幕、且视频时长超过语音转录额度上限的视频（免费账号10分钟，Pro/管理员账号120分钟）无法生成总结。

**EN**：Which videos can't be summarized by AI?
Videos with no subtitles at all, whose length also exceeds the speech-transcription time limit (10 minutes for free accounts, 120 minutes for Pro/admin accounts), can't be summarized.

**PT**：Que vídeos não podem ser resumidos por IA?
Vídeos sem legendas e cuja duração também exceda o limite de transcrição por voz (10 minutos para contas gratuitas, 120 minutos para contas Pro/admin) não podem ser resumidos.

### 11
**中**：AI总结/问答每天能用几次？
免费账号每天3次，Pro会员每天10次（总结和问答共用同一份额度）。

**EN**：How many times can I use AI summary/chat per day?
Free accounts get 3 uses per day, Pro members get 10 per day (summary and chat share the same daily quota).

**PT**：Quantas vezes posso usar o resumo/chat por IA por dia?
Contas gratuitas têm 3 utilizações por dia, membros Pro têm 10 por dia (resumo e chat partilham a mesma cota diária).

---

## 分类：下载限制 / Download Limits / Limites de Download

### 12
**中**：支持哪些格式和画质？
视频+音频、仅视频、仅音频三种模式，具体画质取决于原视频源提供的最高分辨率。

**EN**：What formats and quality levels are supported?
Three modes: video+audio, video only, or audio only. The available quality depends on the highest resolution the original video source provides.

**PT**：Que formatos e qualidades são suportados?
Três modos: vídeo+áudio, apenas vídeo, ou apenas áudio. A qualidade disponível depende da resolução máxima oferecida pela fonte original do vídeo.

### 13
**中**：能下载直播/正在进行中的直播吗？
暂不支持。

**EN**：Can I download live streams / ongoing broadcasts?
Not currently supported.

**PT**：Posso descarregar transmissões em direto / streams em curso?
Não é suportado atualmente.

### 14
**中**：有视频时长/文件大小限制吗？
下载功能本身没有限制；AI转录功能有时长限制（见上面"什么样的视频没法用AI总结"）。

**EN**：Are there limits on video length or file size?
The download feature itself has no limits; the AI transcription feature does have a length limit (see "Which videos can't be summarized by AI?" above).

**PT**：Há limites de duração ou tamanho de ficheiro?
A funcionalidade de download em si não tem limites; a funcionalidade de transcrição por IA tem um limite de duração (ver "Que vídeos não podem ser resumidos por IA?" acima).

---

## 分类：账号与订阅 / Account & Subscription / Conta e Subscrição

### 15
**中**：Pro会员多少钱？包含什么权益？
Pro会员功能暂未开放，具体定价和权益敬请期待，我们会尽快完善。

**EN**：How much does Pro membership cost? What's included?
Pro membership isn't open yet — pricing and benefits are coming soon, stay tuned.

**PT**：Quanto custa a subscrição Pro? O que inclui?
A subscrição Pro ainda não está disponível — o preço e os benefícios serão anunciados em breve.

### 16
**中**：可以随时取消订阅吗？
通过Stripe管理订阅，可以随时取消，取消后到当前计费周期结束前仍可使用Pro权益。

**EN**：Can I cancel my subscription anytime?
Subscriptions are managed through Stripe and can be cancelled anytime — you'll keep Pro benefits until the end of the current billing period.

**PT**：Posso cancelar a subscrição a qualquer momento?
As subscrições são geridas através do Stripe e podem ser canceladas a qualquer momento — manterá os benefícios Pro até ao final do período de faturação atual.

### 17
**中**：现在支持真实付费吗？
目前支付功能处于测试阶段，暂不支持真实付费，敬请期待正式上线。

**EN**：Does real payment work right now?
Payments are currently in testing mode — real payments aren't supported yet, stay tuned for the official launch.

**PT**：Os pagamentos reais funcionam neste momento?
Os pagamentos estão atualmente em modo de teste — os pagamentos reais ainda não são suportados, aguarde o lançamento oficial.

### 18
**中**：支持哪些登录方式？
邮箱密码，或者Google账号一键登录。

**EN**：What login methods are supported?
Email + password, or one-click sign-in with Google.

**PT**：Que métodos de login são suportados?
Email + palavra-passe, ou início de sessão com um clique através do Google.

---

## 分类：故障排查 / Troubleshooting / Resolução de Problemas

### 19
**中**：解析/下载失败了怎么办？
部分平台可能因为反爬限制、地区限制、或视频需要登录才能查看等原因偶发失败，可以稍后重试，或换一个视频链接确认是否为个例。

**EN**：What if parsing/downloading fails?
Some platforms may occasionally fail due to anti-bot restrictions, regional restrictions, or videos requiring login to view. Try again later, or test with a different video link to see if it's an isolated case.

**PT**：O que fazer se a análise/download falhar?
Algumas plataformas podem falhar ocasionalmente devido a restrições anti-bot, restrições regionais, ou vídeos que exigem login para ver. Tente novamente mais tarde, ou teste com outro link de vídeo para verificar se é um caso isolado.

---

## 我的观察（你要求看看问题本身对不对，这里给点意见）

- 19条问题分成5类，跟原来两个竞品的分类结构（General/Limitations/Plus会员）对应得上，
  数量上不算多也不算少
- 第15、17条("Pro多少钱"、"支持真实付费吗")现在答案都是"敬请期待"——这两条现在放上去
  略显尴尬（用户点开FAQ看到"付费功能"结果发现还没做），要不要干脆先不上线这两条，
  等Pro真正开放了再加回来？这个我建议但不替你做决定
- 其余17条我觉得覆盖面可以，没有想到明显遗漏的角度
