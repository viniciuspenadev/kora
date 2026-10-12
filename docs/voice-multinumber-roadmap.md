# Ligações: relatório e operação com vários números

Revisão do código em 2026-10-12. Este documento descreve o estado comprovado e a proposta de evolução; não significa que o suporte a várias linhas já esteja habilitado.

## Estado atual

- Kora resolve apenas uma linha por `BLUE_VOICE_INSTANCE_ID/NAME/URL/API_KEY`.
- Evolution inicializa o motor apenas para `VOICE_CALLS_INSTANCE_NAME`. A elegibilidade é decidida no construtor; habilitação dinâmica ainda exige trabalho.
- Cada instância admite um canal de mídia e uma chamada por vez. O cliente de navegador limita uma chamada por aba, sem reserva global por atendente ou coordenação de várias abas.
- As concessões `tenant_users.voice_instance_ids` já aceitam vários IDs, mas roteamento, motores e interface continuam no piloto de uma linha.
- Mensagens seguem na Evolution atual; a Blue de voz é outro serviço pareado. O destino final é cada número usar mensagens e voz no mesmo socket Baileys da nossa Evolution, após migração validada.
- Histórico atual observa o estado a cada dois segundos no servidor; não possui eventos duráveis do motor, motivo preciso de término ou gravação.

## Relatório entregue nesta etapa

`/relatorios/ligacoes`: gestores ativos veem somente a própria conta; filtros por período, autor da chamada, número, resultado e contato. Indicadores e agrupamento por número contam todas as páginas do período; a tabela apresenta 50 registros por página. O período e os horários usam America/Sao_Paulo. Uma conexão não observada não recebe rótulo de "não atendida". Duração indisponível não entra como zero na média ou no tempo conhecido.

Novas tentativas congelam `instanceId` e `destinationNumber` no evento, evitando atribuir a chamada ao número atual de uma conversa que mudou. Registros antigos são identificados como legados e usam a relação atual da conversa. Não há recuperação retroativa de ligações anteriores à criação do registro, nem coleta de chamadas feitas diretamente no celular.

## Regra recomendada para vários QR Codes

Cada número é uma linha independente, com identidade estável do Kora, sessão QR, serviço de voz, permissões e estado. Abrir uma conversa do número A seleciona A; abrir uma conversa do número B seleciona B. O atendente vê claramente **de qual número está ligando** antes da discagem. O cadastro não permite trocar silenciosamente a origem usando o mesmo histórico.

Para discagem avulsa ou escolha de outra origem, selecionar apenas linhas autorizadas do tenant e relacionar o evento à conversa daquele número. Esse fluxo é posterior ao suporte às chamadas dentro da conversa.

Política inicial: uma chamada por número e uma por atendente em todas as abas. Chamadas simultâneas em números diferentes são a meta da próxima prova com dois números; a capacidade do motor e da VPS ainda precisa ser medida.

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
| Motor de uma linha trava | Isolar worker e limitar recursos; preservar mensagens e outras linhas. Validar se a biblioteca realmente isola duas sessões antes de ampliar. |
| VPS sem capacidade | Medir memória/CPU por motor ocioso e ativo, concorrência de chamadas e impacto nas mensagens. Aquecimento sob demanda e limite de capacidade; não inicializar todos os motores sem medição. |
| Eventos duplicados ou fora de ordem | ID idempotente, sequência e máquina de estados; não duplicar tentativa nem regredir connected para ringing. |
| Reinício do Kora/Evolution | Recuperar eventos duráveis e reconciliar chamadas abertas; manter resultado desconhecido se não houver prova de término. |
| Chamada recebida durante saída | Política de ocupação/recusa compatível com o motor. Recepção permanece fora do piloto atual. |
| Transferência entre atendentes | Troca controlada da posse e da mídia, com auditoria; não confundir com transferir a conversa. Não disponível hoje. |
| Gravação | Conta autoriza o recurso; owner configura a política; captura/armazenamento, acesso, retenção e falhas devem ser definidos antes de apresentar como disponível. |

## Ordem de execução

1. Relatório com os fatos disponíveis e indicação de precisão — esta etapa.
2. Reserva e identificação da linha no cartão, retirando o roteamento global fixo da Blue.
3. Eventos duráveis do motor e tabela de chamadas, com reconciliação e bolha vinculada ao mesmo ID.
4. Prova com dois números e dois atendentes: chamadas simultâneas, disputa da mesma linha, duas abas, perda de rede, desconexão QR, reinício e falta de recursos. Confirmar também mensagens de ida e volta nas duas linhas.
5. Liberar um segundo número piloto; medir; ampliar gradualmente. Gravação, transferência, fila e discador vêm após estabilidade dessa base.
