import { queryOne } from "@/lib/db";
import { updateZone } from "@/app/actions";
import Link from "next/link";

interface ZoneRow {
  zoneidnumber: number;
  short_name: string;
  long_name: string;
  min_level: number;
  max_level: number;
  min_status: number;
  safe_x: number;
  safe_y: number;
  safe_z: number;
  underworld: number;
  graveyard_id: number;
  max_clients: number;
  ruleset: number;
  expansion: number;
  suspendbuffs: number;
  rain_chance1: number;
  rain_chance2: number;
  rain_chance3: number;
  rain_chance4: number;
  rain_duration1: number;
  rain_duration2: number;
  rain_duration3: number;
  rain_duration4: number;
  hot_zone: number;
  peqzone: number;
  shutdowndelay: number;
}

function Field({ label, name, value, type = "number" }: { label: string; name: string; value: any; type?: string }) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        className="w-full px-2 py-1.5 rounded border text-sm"
        style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
      />
    </div>
  );
}

export default async function ZoneEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const zone = await queryOne<ZoneRow>("SELECT * FROM zone WHERE zoneidnumber = ?", [id]);

  if (!zone) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--accent)" }}>Zone Not Found</h1>
        <Link href="/zones" style={{ color: "var(--accent)" }}>Back to Zones</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/zones" className="text-sm hover:underline" style={{ color: "var(--muted)" }}>Zones</Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{zone.long_name}</h1>
        <span className="text-sm font-mono" style={{ color: "var(--muted)" }}>{zone.short_name}</span>
      </div>

      <form action={updateZone}>
        <input type="hidden" name="id" value={zone.zoneidnumber} />

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Basic Info</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <Field label="Long Name" name="long_name" value={zone.long_name} type="text" />
              </div>
              <Field label="Min Level" name="min_level" value={zone.min_level} />
              <Field label="Max Level" name="max_level" value={zone.max_level} />
              <Field label="Min Status" name="min_status" value={zone.min_status} />
              <Field label="Max Clients" name="max_clients" value={zone.max_clients} />
              <Field label="Expansion" name="expansion" value={zone.expansion} />
              <Field label="Ruleset" name="ruleset" value={zone.ruleset} />
              <Field label="Hot Zone" name="hot_zone" value={zone.hot_zone} />
              <Field label="PEQ Zone" name="peqzone" value={zone.peqzone} />
              <Field label="Shutdown Delay" name="shutdowndelay" value={zone.shutdowndelay} />
              <Field label="Suspend Buffs" name="suspendbuffs" value={zone.suspendbuffs} />
            </div>
          </div>

          {/* Safe Point */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Safe Point</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Safe X" name="safe_x" value={zone.safe_x} />
              <Field label="Safe Y" name="safe_y" value={zone.safe_y} />
              <Field label="Safe Z" name="safe_z" value={zone.safe_z} />
              <Field label="Underworld" name="underworld" value={zone.underworld} />
              <Field label="Graveyard ID" name="graveyard_id" value={zone.graveyard_id} />
            </div>
          </div>

          {/* Weather */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Weather</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Rain Chance 1" name="rain_chance1" value={zone.rain_chance1} />
              <Field label="Rain Chance 2" name="rain_chance2" value={zone.rain_chance2} />
              <Field label="Rain Chance 3" name="rain_chance3" value={zone.rain_chance3} />
              <Field label="Rain Chance 4" name="rain_chance4" value={zone.rain_chance4} />
              <Field label="Rain Duration 1" name="rain_duration1" value={zone.rain_duration1} />
              <Field label="Rain Duration 2" name="rain_duration2" value={zone.rain_duration2} />
              <Field label="Rain Duration 3" name="rain_duration3" value={zone.rain_duration3} />
              <Field label="Rain Duration 4" name="rain_duration4" value={zone.rain_duration4} />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" className="px-6 py-2 rounded-lg text-sm font-medium text-black" style={{ backgroundColor: "var(--accent)" }}>
            Save Changes
          </button>
          <Link href="/zones" className="px-6 py-2 rounded-lg text-sm border" style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
