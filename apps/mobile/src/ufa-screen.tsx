import { ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Chip, colors, Empty, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

type UfaConnection = "disabled" | "unavailable" | "observed";
interface UfaTask {
  id: string;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
}
interface UfaEventMeta {
  id: string;
  type: string;
  created_at: string;
  payloadOmitted: true;
}
interface UfaBundleMeta {
  available: boolean;
  reason?: string;
  manifest_sha256?: string;
  signaturePresent?: boolean;
  signatureVerified?: false;
  eventCount?: number;
  artifactCount?: number;
}
interface UfaRun {
  id: string;
  status: string;
  created_at: string;
  finished_at?: string | null;
}
interface UfaView {
  disposition: "NOT_CONNECTED";
  evidence: "fixture" | "unverified";
  live: false;
  connection: UfaConnection;
  reason?: string;
  observedAt?: string;
  tasks?: UfaTask[];
  runs?: UfaRun[];
  task?: UfaTask;
  events?: UfaEventMeta[];
  bundle?: UfaBundleMeta;
}

/** Read-only observation. Never calls UFA from the device. */
export function UfaScreen() {
  const { api } = useWorkspace();
  const [view, setView] = useState<UfaView | null>(null);
  const [detail, setDetail] = useState<UfaView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    setError("");
    setDetail(null);
    try {
      setView(await api.request<UfaView>("/api/ufa/overview"));
    } catch (cause) {
      setView(null);
      setError(cause instanceof Error ? cause.message : "UFA is unavailable");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openTask(id: string) {
    setError("");
    try {
      const next = await api.request<UfaView>(`/api/ufa/tasks/${id}`);
      if (next.connection !== "observed") {
        setError(next.reason || "UFA is unavailable");
        setDetail(null);
        return;
      }
      setDetail(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "UFA is unavailable");
    }
  }

  const observed = view?.connection === "observed";
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 8, backgroundColor: colors.sky }}>
        <Text style={s.label}>Not connected</Text>
        <Text style={s.text}>
          This view only observes UFA. It does not start work, and a visible state is not a claim
          that execution succeeded.
        </Text>
        <Text style={s.small}>
          {view?.evidence === "fixture"
            ? "Fixture data — not a live UFA connection."
            : "Unverified observation — not a certified live connection."}
        </Text>
      </Card>
      <ErrorNotice error={error} />
      {busy && !view ? (
        <Text style={s.muted}>Checking the UFA bridge…</Text>
      ) : !observed ? (
        <Card>
          <Empty
            icon={ShieldCheck}
            title="UFA is unavailable"
            detail={view?.reason || error || "The read-only bridge is turned off."}
          />
        </Card>
      ) : (
        <>
          <Text style={s.small}>
            Observed {view?.observedAt ?? "from UFA"}. Source states and timestamps are unchanged.
          </Text>
          <Text style={s.heading}>Tasks</Text>
          {view?.tasks?.length ? (
            view.tasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => void openTask(task.id)}
              >
                <Card style={{ gap: 6 }}>
                  <View style={s.between}>
                    <Text style={s.heading}>{task.title || "Untitled task"}</Text>
                    <Chip>{task.state}</Chip>
                  </View>
                  <Text style={s.small}>Created {task.created_at}</Text>
                  <Text style={s.small}>Updated {task.updated_at}</Text>
                </Card>
              </Pressable>
            ))
          ) : (
            <Text style={s.muted}>UFA returned no tasks.</Text>
          )}
          <Text style={s.heading}>Runs</Text>
          {view?.runs?.length ? (
            view.runs.map((run) => (
              <Card key={run.id} style={{ gap: 6 }}>
                <View style={s.between}>
                  <Text style={s.text}>{run.id}</Text>
                  <Chip>{run.status}</Chip>
                </View>
                <Text style={s.small}>Created {run.created_at}</Text>
                {run.finished_at ? <Text style={s.small}>Finished {run.finished_at}</Text> : null}
              </Card>
            ))
          ) : (
            <Text style={s.muted}>UFA returned no runs.</Text>
          )}
          {detail?.task && (
            <Card style={{ gap: 8 }}>
              <Text style={s.heading}>{detail.task.title || "Task"}</Text>
              <Text style={s.small}>State {detail.task.state}</Text>
              <Text style={s.label}>Events</Text>
              {detail.events?.length ? (
                detail.events.map((event) => (
                  <Text key={event.id} style={s.small}>
                    {event.created_at} · {event.type}
                    {event.payloadOmitted ? " · payload omitted" : ""}
                  </Text>
                ))
              ) : (
                <Text style={s.muted}>No event metadata.</Text>
              )}
              <Text style={s.label}>Evidence</Text>
              {detail.bundle?.available ? (
                <View style={{ gap: 4 }}>
                  <Text style={s.small}>Manifest {detail.bundle.manifest_sha256}</Text>
                  <Text style={s.small}>
                    Signature {detail.bundle.signaturePresent ? "present" : "absent"}. Not
                    independently verified.
                  </Text>
                  <Text style={s.small}>
                    {detail.bundle.eventCount ?? 0} events · {detail.bundle.artifactCount ?? 0}{" "}
                    artifacts
                  </Text>
                </View>
              ) : (
                <Text style={s.muted}>
                  {detail.bundle?.reason ?? "Evidence metadata is unavailable."}
                </Text>
              )}
            </Card>
          )}
        </>
      )}
      <Button onPress={() => void load()}>Refresh observation</Button>
    </View>
  );
}
