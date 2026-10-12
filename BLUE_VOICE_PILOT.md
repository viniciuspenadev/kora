# Piloto de ligação Blue no Kora

Este piloto adiciona **Ligar** ao cabeçalho de uma conversa WhatsApp da Blue. O atendente autorizado abre um webphone do Kora, fala pelo navegador e desliga ali. O navegador recebe apenas um ticket de mídia com validade curta; a chave da Evolution fica no servidor. A chamada usa a nova Evolution Blue já pareada por QR Code. O envio e recebimento de mensagens continuam na Evolution atualmente configurada em `whatsapp_instances`.

## Configuração do serviço Kora no EasyPanel

Defina estas variáveis somente no serviço `kora`, sem registrar os valores em Git ou neste documento:

```text
BLUE_VOICE_ENABLED=true
BLUE_VOICE_INSTANCE_ID=<id do registro Blue em whatsapp_instances no Kora>
BLUE_VOICE_INSTANCE_NAME=kora-blue-digital-hub-1783030819675
BLUE_VOICE_URL=https://n8n-evolution-blue-voice.3qeebj.easypanel.host
BLUE_VOICE_API_KEY=<chave da instância Blue nova>
```

`AUTH_URL` ou `NEXTAUTH_URL` deve apontar à origem HTTPS real do Kora, pois as ações de voz exigem `Origin` igual. No serviço `evolution-blue-voice`, acrescente essa origem HTTPS a `VOICE_MEDIA_ALLOWED_ORIGINS`, separada por vírgula da origem local já usada no teste. Não altere as variáveis globais `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`, o registro `whatsapp_instances` nem o serviço Evolution atual para habilitar este piloto.

## Liberação por conta e atendente

Antes de implantar a revisão de permissões, aplique `supabase/migrations/20261010000100_voice_entitlements.sql` no projeto Supabase do Kora. A migração adiciona dois módulos desligados por padrão, `voice_calls` e seu filho `voice_recording`, e a lista `voice_instance_ids` em cada membro. Sem a migração, a página da equipe não pode ser carregada; portanto ela precede o deploy.

No God Mode, habilite **Ligações WhatsApp** para a conta. O filho **Gravação de ligações** aparece aninhado, mas permanece identificado como *em preparação*: ainda não existe captura e armazenamento de gravações. Habilitar esse filho por si só não grava áudio. O proprietário da conta escolhe **Permitir ligações** para cada atendente e cada número Baileys em Configurações → Equipe → membro. Proprietário e administrador da conta podem ligar quando o módulo está ativo; atendentes exigem essa concessão explícita e acesso ao número/conversa. Os botões aparecem desabilitados para os demais usuários e números sem infraestrutura de voz.

## Verificação após o deploy do Kora

1. Acesse o Kora como usuário autorizado e abra uma conversa individual WhatsApp da Blue que esteja atribuída a ele, da qual participe, ou para a qual tenha papel de administrador. O ícone de telefone deve estar habilitado. Em conversas de outros números ou para usuários sem permissão, deve aparecer desabilitado.
2. Abra o ícone: o painel flutuante aparece na mesma tela. Clique **Ligar**, permita o microfone e confirme no telefone de teste: toque e áudio nos dois sentidos. As duas ondas mostram a captura local e a reprodução do áudio remoto, sem gravá-los.
3. Minimize, expanda e arraste o painel pela alça superior (as setas do teclado também movem a alça). Navegue entre conversas e outra seção pelo menu interno, mantendo o áudio. **X** minimiza uma chamada ativa; somente **Desligar** pede o encerramento. Teste silenciar/reativar o microfone e desligar nos dois sentidos.
4. Confira o estado livre ao final e faça uma segunda chamada. Se o WebSocket de mídia fechar, a Evolution encerra a chamada. Fechar ou recarregar a aba interrompe o áudio (há aviso nativo durante a chamada); a persistência vale para a navegação interna do Kora na mesma aba.
5. Confirme uma mensagem de ida e volta pela Blue no Kora. O piloto de voz não troca o webhook nem o caminho de mensagens; a futura troca de mensagens para a Evolution nova exige validação própria.

O painel pertence ao layout autenticado, com identidade por conta e usuário. Abrir ou minimizar não solicita microfone nem inicia ligação. O microfone e o canal de mídia são liberados no encerramento, falha ou saída da aplicação. Links antigos `/inbox/voice/:id` abrem o painel no Inbox, sem discagem automática. Esta revisão não altera banco, permissões nem configuração da Evolution.

A Evolution aceita apenas um canal de mídia ativo por instância; os demais atendentes veem a linha ocupada durante a ligação. Ainda falta registrar no Kora a posse e o histórico de cada chamada para auditoria e futura gravação.

## Reversão

Defina `BLUE_VOICE_ENABLED=false` no Kora e reimplante somente o serviço Kora. O ícone e as rotas de voz deixam de operar. A Evolution atual, seus números, banco, Redis, webhooks e mensagens não são alterados por este piloto.
