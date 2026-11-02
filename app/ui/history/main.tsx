// Histórico. Vazio até o T57 (histórico pesquisável) ligar os dados.
import { Empty, mount, Window } from "../src/kit/index.tsx";

function WaveIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden style={{ color: "var(--accent)" }}>
      {[10, 20, 28, 20, 10].map((h, i) => (
        <rect key={i} x={4.5 + i * 6} y={(36 - h) / 2} width={3.5} height={h} rx={1.75} fill="currentColor" />
      ))}
    </svg>
  );
}

function History() {
  return (
    <Window title="Histórico" end={<input className="kn-search" type="search" placeholder="Buscar nos ditados" disabled />}>
      <Empty icon={<WaveIcon />} title="Nenhum ditado ainda">
        Segure <strong>Fn</strong> em qualquer app e fale. Cada ditado aparece aqui, com o texto limpo e o original.
      </Empty>
    </Window>
  );
}

mount(<History />);
