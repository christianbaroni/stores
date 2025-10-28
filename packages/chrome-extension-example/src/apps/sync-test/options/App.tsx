import { useStableValue } from '@stores';
import { memo, useCallback, useState } from 'react';
import { useSortedContexts, useRecentOperations, useOperationStats } from '../shared/derivedStores';
import type { ExtensionContext } from '../shared/syncTestStore';
import { syncTestActions, useSyncTestStore } from '../shared/syncTestStore';
import { useHeartbeat } from '../shared/useHeartbeat';
import './styles.css';

type AppProps = {
  context: ExtensionContext;
};

function formatTimestamp(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return formatter.format(timestamp);
}

const OptionsHeader = memo(function OptionsHeader() {
  const counter = useSyncTestStore(state => state.counter);
  const stats = useOperationStats();

  return (
    <header className="options-header">
      <div className="header-content">
        <h1 className="options-title">Race Condition Playground</h1>
        <p className="options-subtitle">For stress testing sync across extension contexts</p>
      </div>
      <div className="header-stats">
        <div className="stat">
          <div className="stat-value">{counter}</div>
          <div className="stat-label">Counter</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.formattedTotalOps}</div>
          <div className="stat-label">Operations</div>
        </div>
      </div>
    </header>
  );
});

const CounterCard = memo(function CounterCard({ context }: { context: ExtensionContext }) {
  const [customValue, setCustomValue] = useState('');

  const handleSetValue = useCallback(() => {
    const value = parseInt(customValue, 10);
    if (!isNaN(value)) {
      syncTestActions.setCounter(value, context);
      setCustomValue('');
    }
  }, [customValue, context]);

  return (
    <section className="card">
      <h2 className="card-title">Controls</h2>
      <div className="counter-display-large">
        <div className="counter-value-large">
          <CounterValue />
        </div>
      </div>
      <div className="counter-controls-grid">
        <button className="control-button-large decrement" onClick={() => syncTestActions.decrement(context)} type="button">
          <span className="control-icon-large">−</span>
          <span className="control-label">Decrement</span>
        </button>
        <button className="control-button-large increment" onClick={() => syncTestActions.increment(context)} type="button">
          <span className="control-icon-large">+</span>
          <span className="control-label">Increment</span>
        </button>
        <button className="control-button-large reset" onClick={() => syncTestActions.reset(context)} type="button">
          <span className="control-icon-large">↻</span>
          <span className="control-label">Reset</span>
        </button>
      </div>
      <div className="set-value-form">
        <input
          className="value-input-large"
          onChange={e => setCustomValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleSetValue();
            }
          }}
          placeholder="Enter value"
          type="number"
          value={customValue}
        />
        <button className="control-button-large set" onClick={handleSetValue} type="button">
          Set Value
        </button>
      </div>
    </section>
  );
});

const CounterValue = memo(function CounterValue() {
  const counter = useSyncTestStore(state => state.counter);
  return <>{counter}</>;
});

const ActiveContextsCard = memo(function ActiveContextsCard() {
  const contexts = useSortedContexts();

  return (
    <section className="card">
      <h2 className="card-title">Active Contexts</h2>
      {contexts.length === 0 ? (
        <div className="empty-state">No active contexts detected</div>
      ) : (
        <div className="context-grid">
          {contexts.map(ctx => (
            <div key={ctx.sessionId} className="context-card">
              <span className="context-dot-large" style={{ backgroundColor: ctx.color }} />
              <div className="context-info">
                <div className="context-label-large">{ctx.label}</div>
                <div className="context-type-badge">{ctx.type}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

const SettingsCard = memo(function SettingsCard() {
  const autoIncrementOnOpen = useSyncTestStore(state => state.autoIncrementOnOpen);
  const burstMode = useSyncTestStore(state => state.burstMode);

  return (
    <section className="card">
      <h2 className="card-title">Settings</h2>
      <div className="settings-list">
        <div className="setting-item-large">
          <div className="setting-info-large">
            <div className="setting-label-large">Auto-increment on open</div>
            <div className="setting-description-large">Increment on window open to test pre-hydration setState calls</div>
          </div>
          <label className="toggle-switch-large">
            <input checked={autoIncrementOnOpen} onChange={e => syncTestActions.setAutoIncrementOnOpen(e.target.checked)} type="checkbox" />
            <span className="toggle-slider-large" />
          </label>
        </div>
        <div className="setting-item-large">
          <div className="setting-info-large">
            <div className="setting-label-large">Burst mode</div>
            <div className="setting-description-large">Call increment/decrement 10 times in rapid succession instead of once</div>
          </div>
          <label className="toggle-switch-large">
            <input checked={burstMode} onChange={e => syncTestActions.setBurstMode(e.target.checked)} type="checkbox" />
            <span className="toggle-slider-large" />
          </label>
        </div>
      </div>
    </section>
  );
});

const StatsCard = memo(function StatsCard() {
  const stats = useOperationStats();

  return (
    <section className="card">
      <h2 className="card-title">Operation Statistics</h2>
      <div className="setting-description-large" style={{ marginTop: '-8px', marginBottom: '16px' }}>
        Breakdown of up to the last 50 operations
      </div>
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-item-value">{stats.incrementOps}</div>
          <div className="stat-item-label">Increments</div>
        </div>
        <div className="stat-item">
          <div className="stat-item-value">{stats.decrementOps}</div>
          <div className="stat-item-label">Decrements</div>
        </div>
        <div className="stat-item">
          <div className="stat-item-value">{stats.resetOps}</div>
          <div className="stat-item-label">Resets</div>
        </div>
        <div className="stat-item">
          <div className="stat-item-value">{stats.setOps}</div>
          <div className="stat-item-label">Sets</div>
        </div>
      </div>
    </section>
  );
});

const OperationHistoryCard = memo(function OperationHistoryCard() {
  const operations = useRecentOperations();

  return (
    <section className="card full-width">
      <h2 className="card-title">Operation History</h2>
      {operations.length === 0 ? (
        <div className="empty-state">No operations recorded yet</div>
      ) : (
        <div className="operation-table">
          <div className="operation-table-header">
            <div className="operation-table-cell">Type</div>
            <div className="operation-table-cell">Change</div>
            <div className="operation-table-cell">Context</div>
            <div className="operation-table-cell">Time</div>
          </div>
          {operations.map(op => (
            <div key={op.id} className="operation-table-row">
              <div className="operation-table-cell">
                <span className="operation-type-badge">{op.type}</span>
              </div>
              <div className="operation-table-cell">
                <span className="operation-change-display">
                  {op.oldValue} → {op.newValue}
                </span>
              </div>
              <div className="operation-table-cell">
                <span className="context-dot-small" style={{ backgroundColor: op.contextColor }} />
                {op.contextLabel}
              </div>
              <div className="operation-table-cell operation-time">{formatTimestamp(op.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

export function App({ context }: AppProps) {
  useStableValue(() => syncTestActions.increment(context, true));
  useHeartbeat(context);

  return (
    <div className="options-container">
      <OptionsHeader />
      <main className="options-grid">
        <CounterCard context={context} />
        <SettingsCard />
        <ActiveContextsCard />
        <StatsCard />
        <OperationHistoryCard />
      </main>
    </div>
  );
}

export default App;
