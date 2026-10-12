# Registro de ligação na conversa

Em 2026-10-12, uma consulta REST de leitura com `limit=0`, executada com a configuração do próprio contêiner Kora, confirmou HTTP 200 para as colunas existentes de `chat_messages`: `id`, `tenant_id`, `conversation_id`, `sender_id`, `sender_type`, `content_type`, `content`, `status`, `is_private_note`, `metadata` e `created_at`. Não foram consultados valores de mensagens nem aplicada migração.

O registro segue o padrão já usado por eventos de negócio e outras notas internas: `sender_type=system`, `content_type=text`, `is_private_note=true`, `status=delivered`. `sender_id` identifica quem iniciou a tentativa. `metadata.voice_call` contém estado, atendente, ID da chamada e horários observados pelo servidor. Cada tentativa insere uma linha; as atualizações filtram ID, tenant, conversa, tipo e flag interna. O leitor já autorizado da conversa vê a bolha pelo fluxo existente de mensagens e Realtime.

O registro precede a discagem. Se a inserção falhar, a chamada não é iniciada. Respostas que confirmam rejeição classificam a tentativa como não iniciada; timeout ou resposta ambígua classificam como resultado não confirmado. O observador `after()` executa no servidor do Kora e termina após observar encerramento, 15 falhas consecutivas ou 16 minutos. Ele não controla a mídia nem encerra a chamada.

As durações derivam de consultas a cada dois segundos e aparecem com `≈`. Não há indicação de resposta/não resposta quando a conexão não foi observada. Caso o Kora reinicie e perca um observador, a próxima leitura inicial autorizada da conversa classifica registros em andamento com mais de 20 minutos como não confirmados. A atualização usa comparação do JSON anterior para não sobrescrever uma atualização concorrente.

Não é um relatório de telefonia nem uma gravação. Para horários exatos, motivos de término e auditoria completa, a Evolution precisará publicar eventos duráveis do motor de voz. Esta implementação mantém explícitas as lacunas de observação.
