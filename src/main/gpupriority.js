'use strict';

/*
 * Prioridade de GPU (e de CPU) dos processos do GoLive enquanto ha video
 * correndo -- a mesma ideia do "rodar como administrador" do OBS e do
 * "Using realtime GPU priority" do Sunshine.
 *
 * O PROBLEMA: com um jogo pesado (Fortnite, Dead by Daylight, The Last of
 * Us) a GPU fica em ~99% e o agendador WDDM do Windows atende primeiro o
 * jogo, que esta em primeiro plano. Tudo que o GoLive faz com a imagem passa
 * pela mesma GPU, em processos do Chromium com prioridade NORMAL:
 *
 *   - processo do navegador / servico de captura: o WGC entrega o quadro numa
 *     textura e o Chromium o copia para a memoria (Map de uma textura de
 *     staging) -- essa copia espera na fila da GPU atras do jogo;
 *   - renderer: o laco do screenrelay desenha cada quadro no canvas;
 *   - processo de GPU: compoe o canvas e entrega ao NVENC/AMF/QSV.
 *
 * Os logs de 21/11 batem com isso: `cap=10fps` na origem com RTT de 3 ms,
 * perda zero e 1-5% da banda usada. Nao era rede.
 *
 * O QUE FAZ: enquanto a pessoa transmite ou assiste (a mesma regra do
 * keep-awake), sobe a classe de agendamento de GPU de todos os processos do
 * app para HIGH e a de CPU dos que mexem na imagem para ABOVE_NORMAL. Ao
 * parar, volta tudo para NORMAL. Processos que nascem depois (o processo de
 * GPU e recriado quando cai) sao pegos na revisao periodica.
 *
 * POR QUE HIGH E NAO REALTIME: ha relatos de NVENC travando com o processo
 * em REALTIME (forum de desenvolvedores da NVIDIA; o Sunshine troca para
 * HIGH em certas condicoes pelo mesmo motivo), e REALTIME pode exigir
 * privilegio de administrador. `GOLIVE_PRIORIDADE_GPU=realtime` existe para
 * medir, `=off` para desligar. O custo esperado e alguns FPS a menos no
 * proprio jogo -- o mesmo aviso que o OBS da.
 */

// D3DKMT_SCHEDULINGPRIORITYCLASS
const GPU_NORMAL = 2;
const GPU_HIGH = 4;
const GPU_REALTIME = 5;
// SetPriorityClass
const CPU_NORMAL = 0x20; // NORMAL_PRIORITY_CLASS
const CPU_ACIMA = 0x8000; // ABOVE_NORMAL_PRIORITY_CLASS

const INTERVALO_REVISAO_MS = 3000;

/** Le o modo do ambiente: 'high' (padrao), 'realtime' ou 'off'. */
function lerModo(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'desligado') return 'off';
  if (v === 'realtime' || v === 'tempo-real') return 'realtime';
  return 'high';
}

/** Processos que tocam na imagem ganham tambem CPU acima do normal; os
 * outros (renderers da Mesa, YouTube, etc.) so a classe de GPU. */
function querCpu(proc, pidPrincipal) {
  if (proc.type === 'Browser' || proc.type === 'GPU' || proc.type === 'Utility') return true;
  return proc.type === 'Tab' && pidPrincipal != null && proc.pid === pidPrincipal;
}

function hex(status) {
  return `0x${(Number(status) >>> 0).toString(16).padStart(8, '0')}`;
}

/** Texto curto de um resultado do addon, para o log. */
function descreverResultado(proc, r) {
  const rotulo = `${proc.type}${proc.serviceName ? `(${proc.serviceName})` : ''} pid=${proc.pid}`;
  if (!r) return `${rotulo} erro`;
  if (r.status === -1) return `${rotulo} indisponivel`;
  if (r.status === -2) return `${rotulo} sem-acesso(win32=${r.win32Error})`;
  const gpu = r.status === 0 ? `ok(lida=${r.readBack})` : `falhou(${hex(r.status)})`;
  return `${rotulo} gpu=${gpu}${r.cpuApplied ? ' cpu=ok' : ''}`;
}

/**
 * @param {object} deps
 * @param {{ setProcessGpuPriority: Function } | null} deps.addon
 * @param {() => Array<{pid:number,type:string,serviceName?:string}>} deps.listarProcessos
 * @param {() => (number|null)} [deps.pidPrincipal] renderer da janela principal
 * @param {{ log: Function, error: Function }} deps.logger
 * @param {'high'|'realtime'|'off'} [deps.modo]
 */
function criarPrioridadeGpu(deps) {
  const {
    addon,
    listarProcessos,
    pidPrincipal = () => null,
    logger,
    modo = 'high',
    intervaloMs = INTERVALO_REVISAO_MS,
    agendar = (fn, ms) => setInterval(fn, ms),
    desagendar = (id) => clearInterval(id),
  } = deps;

  const disponivel = !!addon && typeof addon.setProcessGpuPriority === 'function';
  const classeGpu = modo === 'realtime' ? GPU_REALTIME : GPU_HIGH;
  /** pid -> { cpu: boolean } dos processos que este controle alterou. */
  const alterados = new Map();
  let ativo = false;
  let timer = null;
  let avisouIndisponivel = false;

  const chamar = (pid, gpu, cpu) => {
    try {
      return addon.setProcessGpuPriority(pid, gpu, cpu);
    } catch (err) {
      logger.error(`[gpu] prioridade: addon lancou para pid=${pid}: ${err?.message || err}`);
      return null;
    }
  };

  const listar = () => {
    try {
      return (listarProcessos() || []).filter((p) => p && Number.isInteger(p.pid) && p.pid > 0);
    } catch (err) {
      logger.error(`[gpu] prioridade: nao listou processos: ${err?.message || err}`);
      return [];
    }
  };

  function revisar() {
    if (!ativo) return;
    const procs = listar();
    const vivos = new Set(procs.map((p) => p.pid));
    // Processo que morreu (ex: GPU que caiu) sai do registro; o substituto
    // entra abaixo como novo.
    for (const pid of alterados.keys()) if (!vivos.has(pid)) alterados.delete(pid);

    const principal = pidPrincipal();
    const linhas = [];
    let falhas = 0;
    for (const proc of procs) {
      if (alterados.has(proc.pid)) continue;
      const cpu = querCpu(proc, principal);
      const r = chamar(proc.pid, classeGpu, cpu ? CPU_ACIMA : 0);
      // Registra mesmo na falha: tentar de novo a cada 3 s so encheria o log.
      alterados.set(proc.pid, { cpu });
      if (!r || r.status !== 0) falhas += 1;
      linhas.push(descreverResultado(proc, r));
    }
    if (linhas.length) {
      logger[falhas ? 'error' : 'log'](`[gpu] prioridade ${modo}: ${linhas.join('; ')}`);
    }
  }

  function restaurar() {
    if (!alterados.size) return;
    const vivos = new Set(listar().map((p) => p.pid));
    let restaurados = 0;
    for (const [pid, { cpu }] of alterados) {
      if (!vivos.has(pid)) continue;
      const r = chamar(pid, GPU_NORMAL, cpu ? CPU_NORMAL : 0);
      if (r && r.status === 0) restaurados += 1;
    }
    alterados.clear();
    logger.log(`[gpu] prioridade normal restaurada em ${restaurados} processo(s)`);
  }

  function definirAtivo(querAtivo) {
    const quer = !!querAtivo;
    if (modo === 'off') return;
    if (!disponivel) {
      if (quer && !avisouIndisponivel) {
        avisouIndisponivel = true;
        logger.error('[gpu] prioridade: addon nativo indisponivel; a captura disputa a GPU com o jogo em prioridade normal');
      }
      return;
    }
    if (quer === ativo) return;
    ativo = quer;
    if (ativo) {
      revisar();
      timer = agendar(revisar, intervaloMs);
      if (timer && typeof timer === 'object') timer.unref?.();
    } else {
      if (timer != null) desagendar(timer);
      timer = null;
      restaurar();
    }
  }

  return {
    definirAtivo,
    revisar,
    encerrar: () => definirAtivo(false),
    get ativo() { return ativo; },
    get modo() { return modo; },
  };
}

module.exports = {
  criarPrioridadeGpu,
  lerModo,
  querCpu,
  descreverResultado,
  GPU_NORMAL,
  GPU_HIGH,
  GPU_REALTIME,
  CPU_NORMAL,
  CPU_ACIMA,
};
