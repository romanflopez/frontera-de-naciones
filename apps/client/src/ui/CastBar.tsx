import { createRoot } from 'react-dom/client';
import { useCastStore } from './castStore';

const wrap: React.CSSProperties = {
    position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', width: 300, height: 20, zIndex: 40,
    display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none',
};
const box: React.CSSProperties = {
    position: 'relative', flex: 1, height: '100%', background: 'rgba(0,0,0,.65)', border: '1px solid rgba(214,164,69,.55)',
    borderRadius: 3, overflow: 'hidden', boxShadow: '0 0 6px rgba(0,0,0,.6)',
};
const fill: React.CSSProperties = {
    position: 'absolute', inset: 0, right: 'auto', transition: 'width 80ms linear, background-color 150ms',
    backgroundImage: 'linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 55%,rgba(0,0,0,.25))',
};
const label: React.CSSProperties = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px',
    font: "600 12px 'Alegreya SC', Georgia, serif", color: '#fff4d6', textShadow: '0 1px 2px #000, 0 0 3px #000',
};

export function CastBar() {
    const { isCasting, spellName, icon, progress, color, glow } = useCastStore();
    if (!isCasting) return null;
    return (
        <div style={wrap} role="progressbar" aria-label={`Casteando ${spellName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
            {icon && <img src={icon} alt="" width={20} height={20} style={{ border: '1px solid rgba(214,164,69,.55)', borderRadius: 3, background: '#000' }} />}
            <div style={box}>
                <div style={{ ...fill, width: `${progress}%`, backgroundColor: color, boxShadow: `0 0 8px ${glow}, inset 0 0 4px ${glow}` }} />
                <div style={label}><span>{spellName}</span><span>{Math.round(progress)}%</span></div>
            </div>
        </div>
    );
}

export function mountCastBar(host: HTMLElement): void { createRoot(host).render(<CastBar />); }
