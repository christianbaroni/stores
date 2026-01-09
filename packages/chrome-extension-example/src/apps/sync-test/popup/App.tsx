import { useStableValue } from 'stores';
import { memo, useCallback, useState } from 'react';
import { useSortedContexts, useRecentOperations, useOperationStats } from '../shared/derivedStores';
import type { ExtensionContext } from '../shared/syncTestStore';
import { syncTestActions, useSyncTestStore } from '../shared/syncTestStore';
import { useHeartbeat } from '../shared/useHeartbeat';
import { RelativeTime } from '../shared/RelativeTime';
import './styles.css';

type AppProps = {
  context: ExtensionContext;
};

const Counter = memo(function Counter({ context }: { context: ExtensionContext }) {
  const [customValue, setCustomValue] = useState('');

  const handleSetValue = useCallback(() => {
    const value = parseInt(customValue, 10);
    if (!isNaN(value)) {
      syncTestActions.setCounter(value, context);
      setCustomValue('');
    }
  }, [customValue, context]);

  return (
    <div className="counter-section">
      <div className="section-title">Controls</div>
      <div className="counter-card">
        <div className="counter-display">
          <div className="counter-value">
            <CounterValue />
          </div>
        </div>
        <div className="counter-controls">
          <div className="button-row">
            <button className="control-button decrement" onClick={() => syncTestActions.decrement(context)} type="button">
              <span className="control-icon">−</span>
            </button>
            <button className="control-button increment" onClick={() => syncTestActions.increment(context)} type="button">
              <span className="control-icon">+</span>
            </button>
          </div>
          <button className="control-button reset" onClick={() => syncTestActions.reset(context)} type="button">
            Reset
          </button>
          <div className="set-value">
            <input
              className="value-input"
              onChange={e => setCustomValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleSetValue();
                }
              }}
              placeholder="Set value"
              type="number"
              value={customValue}
            />
            <button className="control-button set" onClick={handleSetValue} type="button">
              Set
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

const CounterValue = memo(function CounterValue() {
  const counter = useSyncTestStore(state => state.counter);
  return <>{counter}</>;
});

const ActiveContexts = memo(function ActiveContexts() {
  const contexts = useSortedContexts();

  if (contexts.length === 0) {
    return (
      <div className="active-contexts">
        <div className="section-title">Active Contexts</div>
        <div className="no-contexts">No active contexts detected</div>
      </div>
    );
  }

  return (
    <div className="active-contexts">
      <div className="section-title">Active Contexts</div>
      <div className="context-list">
        {contexts.map(ctx => {
          if (!ctx) return null;
          return (
            <div key={ctx.sessionId} className="context-chip">
              <span className="context-dot" style={{ backgroundColor: ctx.color }} />
              <span className="context-label">{ctx.label}</span>
              <span className="context-type">{ctx.type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const Settings = memo(function Settings() {
  const autoIncrementOnOpen = useSyncTestStore(state => state.autoIncrementOnOpen);
  const burstMode = useSyncTestStore(state => state.burstMode);

  return (
    <div className="settings">
      <div className="section-title">Settings</div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-label">Auto-increment on open</div>
          <div className="setting-description">Increment on window open to test pre-hydration setState calls</div>
        </div>
        <label className="toggle-switch">
          <input checked={autoIncrementOnOpen} onChange={e => syncTestActions.setAutoIncrementOnOpen(e.target.checked)} type="checkbox" />
          <span className="toggle-slider" />
        </label>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-label">Burst mode</div>
          <div className="setting-description">Call increment/decrement 10 times in rapid succession instead of once</div>
        </div>
        <label className="toggle-switch">
          <input checked={burstMode} onChange={e => syncTestActions.setBurstMode(e.target.checked)} type="checkbox" />
          <span className="toggle-slider" />
        </label>
      </div>
    </div>
  );
});

const OperationLog = memo(function OperationLog() {
  const operations = useRecentOperations();
  const stats = useOperationStats();

  return (
    <div className="operation-log">
      <div className="section-title">
        Operation Log
        <span className="operation-count">{stats.formattedTotalOps}</span>
      </div>
      {operations.length === 0 ? (
        <div className="no-operations">No operations yet</div>
      ) : (
        <div className="operation-list">
          {operations.slice(0, 10).map(op => (
            <div key={op.id} className="operation-item">
              <span className="operation-dot" style={{ backgroundColor: op.contextColor }} />
              <div className="operation-details">
                <div className="operation-header">
                  <span className="operation-type">{op.type}</span>
                  <span className="operation-time">
                    <RelativeTime timestamp={op.timestamp} />
                  </span>
                </div>
                <div className="operation-change">
                  {op.oldValue} → {op.newValue}
                  <span className="operation-context">{op.contextLabel}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export function App({ context }: AppProps) {
  useStableValue(() => syncTestActions.increment(context, true));
  useHeartbeat(context);

  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1 className="popup-title">Race Condition Playground</h1>
        <p className="popup-subtitle">For stress testing sync across extension contexts</p>
      </div>

      <Counter context={context} />
      <Settings />
      <ActiveContexts />
      <OperationLog />
    </div>
  );
}

export default App;
