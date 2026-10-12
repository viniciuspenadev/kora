# Ligações: relatório e operação com vários números

Revisão do código em 2026-10-12. Este documento descreve o estado comprovado e a proposta de evolução; não significa que o suporte a várias linhas já esteja habilitado.

## Estado atual

- Kora resolve apenas uma linha por `BLUE_VOICE_INSTANCE_ID/NAME/URL/API_KEY`.
- Evolution inicializa o motor apenas para `VOICE_CALLS_INSTANCE_NAME`. A elegibilidade é decidida no construtor; habilitação dinâmica ainda exige trabalho.
- Há uma restrição explícita adicional em `voice/src/wasm-engine.mts`: `Only one VoIP engine is supported per process.` O motor usa callbacks globais e um proprietário global. Uma lista de nomes habilitados, sozinha, faria a inicialização do segundo motor falhar. Este é um limite da implementação atual, não uma conclusão sobre a capacidade do WhatsApp ou do Baileys.
- Cada instância admite um canal de mídia e uma chamada por vez. O cliente de navegador limita uma chamada por aba, sem reserva global por atendente ou coordenação de várias abas.
- As concessões `tenant_users.voice_instance_ids` já aceitam vários IDs, mas roteamento, motores e interface continuam no piloto de uma linha.
- A CSP do Kora permite o domínio WSS de `BLUE_VOICE_URL`; o gateway aceita uma lista explícita de origens. O cadastro de várias linhas deve manter um gateway público estável ou atualizar essas listas de forma restrita, sem liberar domínios arbitrários do navegador.
- Mensagens seguem na Evolution atual; a Blue de voz é outro serviço pareado. O destino final é cada número usar mensagens e voz no mesmo socket Baileys da nossa Evolution, após migração validada.
- Histórico atual observa o estado a cada dois segundos no servidor; não possui eventos duráveis do motor, motivo preciso de término ou gravação.

## Relatório entregue nesta etapa

`/relatorios/ligacoes`: gestores ativos veem somente a própria conta; filtros por período, autor da chamada, número, resultado e contato. Indicadores e agrupamento por número contam todas as páginas do período; a tabela apresenta 50 registros por página. O período e os horários usam America/Sao_Paulo. Uma conexão não observada não recebe rótulo de "não atendida". Duração indisponível não entra como zero na média ou no tempo conhecido.

Novas tentativas congelam `instanceId` e `destinationNumber` no evento, evitando atribuir a chamada ao número atual de uma conversa que mudou. Registros antigos são identificados como legados e usam a relação atual da conversa. Não há recuperação retroativa de ligações anteriores à criação do registro, nem coleta de chamadas feitas diretamente no celular.

## Regra recomendada para vários QR Codes

Cada número é uma linha independente, com identidade estável do Kora, sessão QR, serviço de voz, permissões e estado. Abrir uma conversa do número A seleciona A; abrir uma conversa do número B seleciona B. O atendente vê claramente **de qual número está ligando** antes da discagem. O cadastro não permite trocar silenciosamente a origem usando o mesmo histórico.

Para discagem avulsa ou escolha de outra origem, selecionar apenas linhas autorizadas do tenant e relacionar o evento à conversa daquele número. Esse fluxo é posterior ao suporte às chamadas dentro da conversa.

Política inicial: uma chamada por número e uma por atendente em todas as abas. Chamadas simultâneas em números diferentes são a meta da próxima prova com dois números; a capacidade do motor e da VPS ainda precisa ser medida.

## Isolamento do motor

O desenho recomendado mantém a Evolution como dona dos sockets e das credenciais Baileys, com um processo de voz isolado por linha. Uma ponte de sinalização e áudio conecta esse processo à sessão correta; o socket Baileys não deve ser copiado nem repareado só para isolar o WASM. Essa ponte precisa ser implementada: a interface atual do VoipClient recebe um WASocket diretamente, que não é transferível como objeto para outro processo.

Preferir um único gateway público de áudio, que roteia por instância para os processos internos autorizados. Isso mantém a origem WSS estável, simplifica a CSP e evita expor uma porta pública para cada motor. O ticket continua de uso único e passa a ser vinculado à reserva, à linha e à sessão.

Para uma prova inicial, dois serviços piloto completos e isolados podem separar os motores, com sessões, banco/cache e roteamento explicitamente separados. Isso é uma alternativa de teste, com custo de recursos, não o modelo final de um contêiner manual por cliente. Não restaurar as mesmas instâncias/auth em dois serviços concorrentes compartilhando o armazenamento.

Testar dois motores em processos separados prova o isolamento; integrar dois números na mesma Evolution com a ponte prova o produto. Nenhuma dessas duas provas está concluída nesta etapa.

## Estrutura proposta, ainda não aplicada ao banco

1. Cadastro de serviços de voz controlado pela plataforma, com URL e referência segura à credencial; vinculação explícita por instância, sem URL/chave enviada pelo navegador.
2. Elegibilidade de voz por número. God Mode concede à conta; owner concede por atendente e número; o servidor valida conta, membro ativo, conversa, linha e concessão em cada operação.
3. `voice_calls`: ID da tentativa, tenant, instância, conversa, contato, autor, snapshots da origem/destino e nome do atendente, timestamps, resultado, motivo e precisão dos dados.
4. `voice_call_events`: eventos duráveis, com ID único e ordem/sequência do motor; consumo idempotente, repetição após falha e reconciliação. A bolha e o relatório devem usar essa mesma chamada, sem dois históricos divergentes.
5. Reserva atômica por linha e por operador, antes de emitir ticket de mídia. Proprietário inclui tenant, usuário, sessão do navegador e tentativa. Só o proprietário controla mudo, áudio e encerramento da chamada correspondente.

Antes de qualquer migração, mapear colunas, índices, FKs, RLS, gatilhos e dados reais de produção. Migração aditiva, inicialmente somente Blue; ampliar por conta/número com possibilidade de reversão.

## Gaps e regras de tratamento

| Situação | Regra necessária |
| --- | --- |
| Dois atendentes clicam juntos | Reserva atômica; o segundo recebe linha ocupada. A reserva começa antes da preparação do áudio, não apenas na discagem. |
| Segundo ticket invalida o primeiro | Ticket vinculado à reserva e sessão; preparar a linha não pode sobrescrever o ticket de outra pessoa. |
| Mesmo atendente em várias abas | Reserva global por operador; aba secundária informa onde a chamada está ativa. |
| Reserva expira durante chamada | Consultar o motor antes de liberar a linha. Expiração não equivale a chamada encerrada. |
| Browser/rede cai | Estado de término explícito; reconciliação. Reconectar mídia só com propriedade validada e sem rediscagem automática. Hoje fechar/recarregar a aba encerra o áudio. |
| QR desconectado ou sessão substituída | Invalidar tickets e reservas da geração anterior; recusar chamadas até sessão e motor estarem prontos. |
| Conta/atendente perde permissão | Política explícita para chamada já em andamento, com autoridade de encerramento preservada e novas chamadas negadas. |
| Segundo motor no mesmo processo | Hoje é recusado explicitamente. Isolar o motor por processo e implementar a ponte com o Baileys; apenas remover o bloqueio não resolve os callbacks globais. |
| Motor de uma linha trava | Isolar o processo e limitar recursos; preservar mensagens e outras linhas. Validar recuperação sem repareamento ou perda de sessão. |
| VPS sem capacidade | Medir memória/CPU por motor ocioso e ativo, concorrência de chamadas e impacto nas mensagens. Aquecimento sob demanda e limite de capacidade; não inicializar todos os motores sem medição. |
| Eventos duplicados ou fora de ordem | ID idempotente, sequência e máquina de estados; não duplicar tentativa nem regredir connected para ringing. |
| Reinício do Kora/Evolution | Recuperar eventos duráveis e reconciliar chamadas abertas; manter resultado desconhecido se não houver prova de término. |
| Chamada recebida durante saída | Política de ocupação/recusa compatível com o motor. Recepção permanece fora do piloto atual. |
| Ligação iniciada no celular ou fora do Kora | O relatório atual não coleta essas chamadas. Só registrar ocupação, origem e resultado quando houver evento confiável do protocolo; não presumir que o estado local do motor cobre todos os aparelhos vinculados. |
| Mudança de domínio/gateway | Conferir CSP, origem aceita, TLS e upgrade WebSocket. Habilitar somente origens cadastradas pela plataforma; preservar chaves no servidor. |
| Transferência entre atendentes | Troca controlada da posse e da mídia, com auditoria; não confundir com transferir a conversa. Não disponível hoje. |
| Gravação | Conta autoriza o recurso; owner configura a política; captura/armazenamento, acesso, retenção e falhas devem ser definidos antes de apresentar como disponível. |

## Ordem de execução

1. Relatório com os fatos disponíveis e indicação de precisão — esta etapa.
2. Prova de isolamento de dois motores, desenho da ponte com o Baileys, reserva e identificação da linha no cartão. Retirar o roteamento global fixo da Blue.
3. Eventos duráveis do motor e tabela de chamadas, com reconciliação e bolha vinculada ao mesmo ID.
4. Integrar a ponte e fazer prova com dois números e dois atendentes: chamadas simultâneas, disputa da mesma linha, duas abas, perda de rede, desconexão QR, reinício e falta de recursos. Confirmar também mensagens de ida e volta nas duas linhas.
5. Liberar um segundo número piloto; medir; ampliar gradualmente. Gravação, transferência, fila e discador vêm após estabilidade dessa base.
