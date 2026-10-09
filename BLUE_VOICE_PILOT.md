# Piloto de ligação Blue no Kora

Este piloto adiciona **Ligar** ao cabeçalho de uma conversa WhatsApp da Blue. O atendente autorizado abre um webphone do Kora, fala pelo navegador e desliga ali. O navegador recebe apenas um ticket de mídia com validade curta; a chave da Evolution fica no servidor. A chamada usa a nova Evolution Blue já pareada por QR Code. O envio e recebimento de mensagens continuam na Evolution atualmente configurada em `whatsapp_instances`.

## Configuração do serviço Kora no EasyPanel

Defina estas variáveis somente no serviço `kora`, sem registrar os valores em Git ou neste documento:

```text
BLUE_VOICE_ENABLED=true
BLUE_VOICE_TENANT_ID=<tenant_id da Blue no Kora>
BLUE_VOICE_INSTANCE_ID=<id do registro Blue em whatsapp_instances no Kora>
BLUE_VOICE_USER_ID=<user_id do primeiro atendente do piloto>
BLUE_VOICE_INSTANCE_NAME=kora-blue-digital-hub-1783030819675
BLUE_VOICE_URL=https://n8n-evolution-blue-voice.3qeebj.easypanel.host
BLUE_VOICE_API_KEY=<chave da instância Blue nova>
```

`AUTH_URL` ou `NEXTAUTH_URL` deve apontar à origem HTTPS real do Kora, pois as ações de voz exigem `Origin` igual. No serviço `evolution-blue-voice`, acrescente essa origem HTTPS a `VOICE_MEDIA_ALLOWED_ORIGINS`, separada por vírgula da origem local já usada no teste. Não altere as variáveis globais `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`, o registro `whatsapp_instances` nem o serviço Evolution atual para habilitar este piloto.

## Verificação após o deploy do Kora

1. Acesse o Kora como o usuário definido em `BLUE_VOICE_USER_ID` e abra uma conversa individual WhatsApp da Blue que esteja atribuída a ele, da qual participe, ou para a qual tenha papel de administrador. O ícone de telefone deve aparecer no cabeçalho. Em conversas de outros números ele não deve aparecer.
2. Abra o ícone, permita o microfone, clique **Ligar** e confirme no telefone de teste: toque, áudio nos dois sentidos e desligamento nos dois aparelhos.
3. Confira o estado livre ao final. Se o WebSocket de mídia fechar, a Evolution encerra a chamada. Uma aba fechada também interrompe o áudio.
4. Confirme uma mensagem de ida e volta pela Blue no Kora. O piloto de voz não troca o webhook nem o caminho de mensagens; a futura troca de mensagens para a Evolution nova exige validação própria.

O primeiro piloto permite **um usuário configurado**. A Evolution aceita apenas um canal de mídia ativo por instância. Antes de liberar vários atendentes, é preciso uma reserva de chamada compartilhada entre réplicas do Kora, associada ao usuário/conversa e ao `callId`, além de auditoria e permissão administrativa por atendente.

## Reversão

Defina `BLUE_VOICE_ENABLED=false` no Kora e reimplante somente o serviço Kora. O ícone e as rotas de voz deixam de operar. A Evolution atual, seus números, banco, Redis, webhooks e mensagens não são alterados por este piloto.
