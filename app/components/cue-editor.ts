import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import type { Act, Cue, CueDraft, CueIssue, CueKind, Scene, ShowData, VersionDiff, VersionSnapshot } from 'stage-cue-editor/models/show';
import { CUE_KINDS, OWNERS } from 'stage-cue-editor/models/show';

const STORAGE_KEY = 'sologsb-1013-stage-cue-editor-v1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function cue(id: string, kind: CueKind, title: string, duration: number, owner: string, extra: Partial<Cue> = {}): Cue {
  return {
    id,
    kind,
    title,
    duration,
    owner,
    lighting: '',
    sound: '',
    props: [],
    cast: [],
    notes: '',
    dependsOn: [],
    offset: 0,
    ...extra,
  };
}

function initialShow(): ShowData {
  const acts: Act[] = [
    { id: 'act-1', name: '第一幕', changeover: 0 },
    { id: 'act-2', name: '第二幕', changeover: 300 },
  ];
  const scenes: Scene[] = [
    {
      id: 'scene-1',
      actId: 'act-1',
      name: 'S1',
      title: '月下序场',
      startTime: '19:30',
      locked: false,
      cues: [
        cue('cue-light-1', '灯光', '观众席渐暗 · 面光起', 45, '李岚', { lighting: 'FOH 1 号面光 65%，侧光暖白 40%', notes: '开演铃后 10 秒执行' }),
        cue('cue-actor-1', '演员', '说书人自左台入场', 90, '赵一帆', { cast: ['说书人／周启'], props: ['折扇'], notes: '追光跟随；入场后停留台中' }),
        cue('cue-sound-1', '音响', '古琴引子淡入', 120, '陈默', { sound: 'Q1 古琴引子，-18dB 淡入 6 秒', dependsOn: ['cue-deleted-old'], notes: '旧版依赖保留用于检查示例' }),
        cue('cue-prop-1', '道具', '月牙灯升至舞台中线', 75, '孙禾', { props: ['月牙灯'], lighting: '顶排 3 号定点' }),
      ],
    },
    {
      id: 'scene-2',
      actId: 'act-2',
      name: 'S2',
      title: '宫门夜宴',
      startTime: '19:40',
      locked: false,
      cues: [
        cue('cue-stage-2', '舞台', '中景屏风换为朱红', 60, '', { notes: '负责人尚未确认' }),
        cue('cue-actor-2', '演员', '群臣列队入场', 110, '赵一帆', { cast: ['群演 6 人', '侍女 4 人'], props: ['宫灯'] }),
        cue('cue-light-2', '灯光', '暖金顶光覆盖后区', 80, '李岚', { lighting: '顶光 4、5 号 70%，色温 3200K' }),
      ],
    },
  ];
  scenes.forEach((scene) => recalculateScene(scene));
  return {
    title: '《长夜行》首演提示表',
    venue: '实验剧场 A 厅',
    date: '2026-10-18',
    acts,
    scenes,
    updatedAt: new Date().toISOString(),
  };
}

function migrateShow(show: ShowData): ShowData {
  if (!Array.isArray(show.acts)) show.acts = [];
  show.scenes.forEach((scene) => {
    const legacy = scene as Scene & { act?: string };
    if (legacy.actId) return;
    const name = legacy.act ?? '第一幕';
    let act = show.acts.find((item) => item.name === name);
    if (!act) {
      act = { id: uid('act'), name, changeover: 0 };
      show.acts.push(act);
    }
    legacy.actId = act.id;
  });
  show.acts.forEach((act) => {
    act.changeover = Math.max(0, Number(act.changeover) || 0);
  });
  return show;
}

function loadShow(): ShowData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialShow();
    const parsed = JSON.parse(raw) as { show: ShowData; versions: VersionSnapshot[] };
    return parsed.show ? migrateShow(parsed.show) : initialShow();
  } catch {
    return initialShow();
  }
}

function loadVersions(): VersionSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as { versions: VersionSnapshot[] }).versions ?? [];
  } catch {
    return [];
  }
}

function recalculateScene(scene: Scene): void {
  let elapsed = 0;
  scene.cues.forEach((item) => {
    item.offset = elapsed;
    elapsed += Number(item.duration) || 0;
  });
}

function startSeconds(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 3600 + Number(minute) * 60;
}

function sceneDuration(scene: Scene): number {
  return scene.cues.reduce((total, item) => total + (Number(item.duration) || 0), 0);
}

function actNameOf(data: ShowData, scene: Scene): string {
  const legacy = scene as Scene & { act?: string };
  return data.acts?.find((act) => act.id === scene.actId)?.name ?? legacy.act ?? '未分幕';
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
  return seconds ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${minutes}分`;
}

function timeLabel(scene: Scene, offset: number): string {
  const total = startSeconds(scene.startTime) + offset;
  const hour = Math.floor((total % 86400) / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return [hour, minute, second].map((part) => String(part).padStart(2, '0')).join(':');
}

function overlaps(aStart: number, aDuration: number, bStart: number, bDuration: number): boolean {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

export default class CueEditorComponent extends Component {
  @tracked show: ShowData = loadShow();
  @tracked versions: VersionSnapshot[] = loadVersions();
  @tracked activeSceneId = this.show.scenes[0]?.id ?? '';
  @tracked selectedCueId = this.show.scenes[0]?.cues[0]?.id ?? '';
  @tracked draft: CueDraft | null = null;
  @tracked compareVersionId = '';
  @tracked message = '';
  @tracked search = '';

  private undoStack: ShowData[] = [];
  private redoStack: ShowData[] = [];
  private dragCueId = '';

  constructor(owner: unknown, args: Record<string, unknown>) {
    super(owner, args);
    window.addEventListener('keydown', this.handleKeyboard);
  }

  get activeScene(): Scene | undefined {
    return this.show.scenes.find((scene) => scene.id === this.activeSceneId);
  }

  get activeAct(): Act | undefined {
    return this.show.acts.find((act) => act.id === this.activeScene?.actId);
  }

  get activeActGroup() {
    return this.actGroups.find((group) => group.act.id === this.activeAct?.id);
  }

  get selectedCue(): Cue | undefined {
    return this.activeScene?.cues.find((item) => item.id === this.selectedCueId);
  }

  get cueRows() {
    if (!this.activeScene) return [];
    return this.activeScene.cues.map((item, index) => ({
      ...item,
      index,
      start: timeLabel(this.activeScene as Scene, item.offset),
      end: timeLabel(this.activeScene as Scene, item.offset + item.duration),
      selected: item.id === this.selectedCueId,
      hasIssue: this.issues.some((issue) => issue.cueId === item.id),
      kindClass: item.kind === '灯光' ? 'light' : item.kind === '音响' ? 'sound' : item.kind === '道具' ? 'prop' : item.kind === '演员' ? 'cast' : item.kind === '字幕' ? 'caption' : 'stage',
      propsLabel: item.props.join('、'),
      castLabel: item.cast.join('、'),
    }));
  }

  get actGroups() {
    const term = this.search.trim().toLowerCase();
    return this.show.acts.map((act) => {
      const scenes = this.show.scenes
        .filter((scene) => scene.actId === act.id)
        .filter((scene) => !term || `${act.name}${scene.name}${scene.title}`.toLowerCase().includes(term))
        .map((scene) => ({
          ...scene,
          active: scene.id === this.activeSceneId,
          issueCount: this.issues.filter((issue) => issue.sceneId === scene.id).length,
          duration: sceneDuration(scene),
        }));
      const starts = scenes.map((scene) => startSeconds(scene.startTime));
      const ends = scenes.map((scene, index) => starts[index]! + scene.duration);
      const span = scenes.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : 0;
      return { act, scenes, durationLabel: formatSeconds(span) };
    });
  }

  get actOptions(): Act[] {
    return this.show.acts;
  }

  get cueKindOptions(): CueKind[] {
    return CUE_KINDS;
  }

  get ownerOptions(): string[] {
    return OWNERS;
  }

  get allCues(): Array<{ cue: Cue; scene: Scene }> {
    return this.show.scenes.flatMap((scene) => scene.cues.map((item) => ({ cue: item, scene })));
  }

  get issues(): CueIssue[] {
    const issues: CueIssue[] = [];
    this.allCues.forEach(({ cue: item, scene }) => {
      const actName = actNameOf(this.show, scene);
      if (!item.owner) {
        issues.push({ id: `owner-${item.id}`, severity: 'error', title: '负责人空缺', detail: `${actName} ${scene.name}「${item.title}」尚未指定负责人。`, sceneId: scene.id, cueId: item.id });
      }
      item.dependsOn.forEach((reference) => {
        if (!this.allCues.some((entry) => entry.cue.id === reference)) {
          issues.push({ id: `ref-${item.id}-${reference}`, severity: 'error', title: '提示被引用但已删除', detail: `「${item.title}」仍依赖已删除的提示 ${reference}。`, sceneId: scene.id, cueId: item.id });
        }
      });
      const previous = scene.cues[scene.cues.indexOf(item) - 1];
      if (previous && item.offset < previous.offset + previous.duration) {
        issues.push({ id: `overlap-${item.id}`, severity: 'error', title: '同场时间冲突', detail: `「${item.title}」与上一条提示重叠。`, sceneId: scene.id, cueId: item.id });
      }
    });

    const allCues = this.allCues;
    for (let index = 0; index < allCues.length; index += 1) {
      for (let next = index + 1; next < allCues.length; next += 1) {
        const left = allCues[index]!;
        const right = allCues[next]!;
        if (left.cue.id === right.cue.id || left.scene.id === right.scene.id) continue;
        const leftStart = startSeconds(left.scene.startTime) + left.cue.offset;
        const rightStart = startSeconds(right.scene.startTime) + right.cue.offset;
        if (!overlaps(leftStart, left.cue.duration, rightStart, right.cue.duration)) continue;
        const sharedProps = left.cue.props.filter((value) => right.cue.props.includes(value));
        const sharedCast = left.cue.cast.filter((value) => right.cue.cast.includes(value));
        if (sharedProps.length) {
          issues.push({ id: `prop-${left.cue.id}-${right.cue.id}`, severity: 'warning', title: '道具撞场', detail: `「${left.cue.title}」与「${right.cue.title}」同时使用：${sharedProps.join('、')}。`, sceneId: right.scene.id, cueId: right.cue.id });
        }
        if (sharedCast.length) {
          issues.push({ id: `cast-${left.cue.id}-${right.cue.id}`, severity: 'warning', title: '演员撞场', detail: `「${left.cue.title}」与「${right.cue.title}」同时需要：${sharedCast.join('、')}。`, sceneId: right.scene.id, cueId: right.cue.id });
        }
      }
    }
    const acts = this.show.acts;
    for (let index = 1; index < acts.length; index += 1) {
      const prevAct = acts[index - 1]!;
      const act = acts[index]!;
      const prevScenes = this.show.scenes.filter((scene) => scene.actId === prevAct.id);
      const actScenes = this.show.scenes.filter((scene) => scene.actId === act.id);
      if (!prevScenes.length || !actScenes.length) continue;
      const prevEnd = Math.max(...prevScenes.map((scene) => startSeconds(scene.startTime) + sceneDuration(scene)));
      const actStart = Math.min(...actScenes.map((scene) => startSeconds(scene.startTime)));
      const gap = actStart - prevEnd;
      const need = Number(act.changeover) || 0;
      if (gap < need) {
        issues.push({
          id: `changeover-${act.id}`,
          severity: 'error',
          title: '幕间换景时间不足',
          detail: `「${prevAct.name}」散场到「${act.name}」开场仅 ${gap} 秒，本幕开场前需预留 ${need} 秒换景，还差 ${need - gap} 秒。`,
          sceneId: actScenes[0]!.id,
        });
      }
    }
    return issues.map((issue) => ({ ...issue, icon: issue.severity === 'error' ? '!' : 'i' }));
  }

  get selectedProps(): string {
    return this.selectedCue?.props.join('、') ?? '';
  }

  get selectedCast(): string {
    return this.selectedCue?.cast.join('、') ?? '';
  }

  get errors(): number {
    return this.issues.filter((issue) => issue.severity === 'error').length;
  }

  get compareVersion(): VersionSnapshot | undefined {
    return this.versions.find((version) => version.id === this.compareVersionId);
  }

  get versionDiff(): VersionDiff[] {
    const version = this.compareVersion;
    if (!version) return [];
    const lines = (data: ShowData) => data.scenes.flatMap((scene) => scene.cues.map((item) => `${actNameOf(data, scene)}/${scene.name} · ${item.title} | ${item.owner || '未指定'} | ${item.duration}s`));
    const before = lines(version.data);
    const after = lines(this.show);
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
      id: `diff-${index}`,
      changed: before[index] !== after[index],
      label: `提示 ${index + 1}`,
      before: before[index] ?? '—',
      after: after[index] ?? '—',
    }));
  }

  @action
  locateIssue(issue: CueIssue): void {
    if (issue.sceneId && this.show.scenes.some((scene) => scene.id === issue.sceneId)) this.activeSceneId = issue.sceneId;
    if (issue.cueId) this.selectedCueId = issue.cueId;
  }

  @action
  selectScene(id: string): void {
    this.activeSceneId = id;
    this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
    this.draft = null;
  }

  @action
  selectCue(id: string): void {
    this.selectedCueId = id;
    this.draft = null;
  }

  @action
  updateShowTitle(value: string): void {
    this.mutate((show) => {
      show.title = value;
    });
  }

  @action
  createCueDraft(kind: CueKind = '灯光'): void {
    if (this.activeScene?.locked) {
      this.notify('该场次已锁定，请先建立修订');
      return;
    }
    this.draft = { kind, title: '', duration: 60, owner: '', lighting: '', sound: '', props: '', cast: '', notes: '', dependsOn: '' };
  }

  @action
  cancelDraft(): void {
    this.draft = null;
  }

  @action
  editSelectedCue(): void {
    const item = this.selectedCue;
    if (!item || this.activeScene?.locked) return;
    this.draft = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      duration: item.duration,
      owner: item.owner,
      lighting: item.lighting,
      sound: item.sound,
      props: item.props.join('、'),
      cast: item.cast.join('、'),
      notes: item.notes,
      dependsOn: item.dependsOn.join('、'),
    };
  }

  @action
  updateDraft<K extends keyof CueDraft>(field: K, value: CueDraft[K]): void {
    if (this.draft) this.draft = { ...this.draft, [field]: value };
  }

  @action
  saveDraft(): void {
    if (!this.draft || !this.draft.title.trim() || !this.activeScene) return;
    const draft = this.draft;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene) return;
      const saved: Cue = {
        id: draft.id ?? uid('cue'),
        kind: draft.kind,
        title: draft.title.trim(),
        duration: Math.max(1, Number(draft.duration) || 1),
        owner: draft.owner,
        lighting: draft.lighting,
        sound: draft.sound,
        props: draft.props.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        cast: draft.cast.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        notes: draft.notes,
        dependsOn: draft.dependsOn.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        offset: 0,
      };
      const index = scene.cues.findIndex((item) => item.id === saved.id);
      if (index >= 0) scene.cues.splice(index, 1, saved);
      else scene.cues.push(saved);
      recalculateScene(scene);
      this.selectedCueId = saved.id;
    });
    this.draft = null;
  }

  @action
  removeCue(id: string): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene || scene.locked) return;
      scene.cues = scene.cues.filter((item) => item.id !== id);
      recalculateScene(scene);
    });
    this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
  }

  @action
  addScene(): void {
    const scene: Scene = {
      id: uid('scene'),
      actId: this.activeScene?.actId ?? this.show.acts[this.show.acts.length - 1]?.id ?? '',
      name: `S${this.show.scenes.length + 1}`,
      title: '未命名场次',
      startTime: '20:00',
      locked: false,
      cues: [],
    };
    this.mutate((show) => show.scenes.push(scene));
    this.activeSceneId = scene.id;
    this.selectedCueId = '';
  }

  @action
  addAct(): void {
    const act: Act = { id: uid('act'), name: `第${this.show.acts.length + 1}幕`, changeover: 120 };
    this.mutate((show) => show.acts.push(act));
    this.notify(`已新增${act.name}，换景秒数与幕名可在幕设置中修改`);
  }

  @action
  updateActField(field: 'name' | 'changeover', value: string | number): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      const act = show.acts.find((item) => item.id === scene?.actId);
      if (!act) return;
      if (field === 'changeover') act.changeover = Math.max(0, Number(value) || 0);
      else act.name = String(value);
    });
  }

  @action
  moveSceneToAct(act: Act): void {
    if (!act || this.activeScene?.locked) return;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (scene) scene.actId = act.id;
    });
    this.notify(`本场已移至${act.name}`);
  }

  @action
  copyPreviousScene(): void {
    const index = this.show.scenes.findIndex((scene) => scene.id === this.activeSceneId);
    const previous = this.show.scenes[index - 1];
    if (!previous) {
      this.notify('当前已是第一场');
      return;
    }
    const copied: Scene = clone(previous);
    copied.id = uid('scene');
    copied.actId = this.activeScene?.actId ?? copied.actId;
    copied.name = `${copied.name}-副本`;
    copied.title = `${copied.title}（复制）`;
    copied.cues = copied.cues.map((item) => ({ ...item, id: uid('cue'), dependsOn: [] }));
    recalculateScene(copied);
    this.mutate((show) => show.scenes.splice(index + 1, 0, copied));
    this.activeSceneId = copied.id;
    this.selectedCueId = copied.cues[0]?.id ?? '';
    this.notify('已复制上一场流程');
  }

  @action
  updateSceneField(field: 'title' | 'startTime' | 'name', value: string): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (scene && !scene.locked) scene[field] = value;
    });
  }

  @action
  updateSelectedField(field: keyof Cue, value: unknown): void {
    const id = this.selectedCueId;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      const item = scene?.cues.find((entry) => entry.id === id);
      if (!scene || !item || scene.locked) return;
      if (field === 'duration') item.duration = Math.max(1, Number(value) || 1);
      else if (field === 'props' || field === 'cast') item[field] = String(value).split(/[、,，]/).map((entry) => entry.trim()).filter(Boolean);
      else Object.assign(item, { [field]: value });
      recalculateScene(scene);
    });
  }

  @action
  moveSelected(direction: -1 | 1): void {
    const cues = this.activeScene?.cues ?? [];
    const from = cues.findIndex((item) => item.id === this.selectedCueId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= cues.length) return;
    this.moveCue(cues[from]!.id, cues[to]!.id);
  }

  @action
  startDrag(id: string): void {
    this.dragCueId = id;
  }

  @action
  allowDrop(event: DragEvent): boolean {
    event.preventDefault();
    return false;
  }

  @action
  dropOn(id: string): void {
    if (this.dragCueId) this.moveCue(this.dragCueId, id);
    this.dragCueId = '';
  }

  @action
  moveCue(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene || scene.locked) return;
      const from = scene.cues.findIndex((item) => item.id === sourceId);
      const to = scene.cues.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = scene.cues.splice(from, 1);
      scene.cues.splice(to, 0, moved!);
      recalculateScene(scene);
    });
    this.selectedCueId = sourceId;
    this.notify('顺序已更新，后续提示时间自动顺延');
  }

  @action
  lockVersion(): void {
    const snapshot: VersionSnapshot = {
      id: uid('version'),
      name: `锁定版 ${this.versions.length + 1}`,
      createdAt: new Date().toISOString(),
      data: clone(this.show),
    };
    this.versions = [snapshot, ...this.versions];
    this.compareVersionId = snapshot.id;
    this.persist();
    this.notify('已锁定当前版本');
  }

  @action
  createRevision(): void {
    this.mutate((show) => show.scenes.forEach((scene) => { scene.locked = false; }));
    this.notify('已从当前锁定版建立可编辑修订');
  }

  @action
  toggleSceneLock(): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (scene) scene.locked = !scene.locked;
    });
  }

  @action
  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.show));
    this.show = previous;
    this.ensureSelection();
    this.persist();
  }

  @action
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.show));
    this.show = next;
    this.ensureSelection();
    this.persist();
  }

  @action
  setSearch(value: string): void {
    this.search = value;
  }

  @action
  selectCompareVersion(version: VersionSnapshot): void {
    this.compareVersionId = version.id;
  }

  willDestroy(): void {
    super.willDestroy();
    window.removeEventListener('keydown', this.handleKeyboard);
  }

  private mutate(mutator: (show: ShowData) => void): void {
    this.undoStack.push(clone(this.show));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    const next = clone(this.show);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.show = next;
    this.ensureSelection();
    this.persist();
  }

  private ensureSelection(): void {
    if (!this.show.scenes.some((scene) => scene.id === this.activeSceneId)) this.activeSceneId = this.show.scenes[0]?.id ?? '';
    if (!this.activeScene?.cues.some((item) => item.id === this.selectedCueId)) this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ show: this.show, versions: this.versions }));
  }

  private notify(value: string): void {
    this.message = value;
    window.setTimeout(() => {
      if (this.message === value) this.message = '';
    }, 2200);
  }

  private handleKeyboard = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const inEditor = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.tagName === 'SELECT';
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (inEditor) return;
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelected(-1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelected(1);
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.createCueDraft();
    }
  };
}
