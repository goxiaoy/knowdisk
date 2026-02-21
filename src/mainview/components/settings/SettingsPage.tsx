import { useState } from "react";

export function SettingsPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
