import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import type {
  Act,
  Cue,
  CueDraft,
  CueIssue,
  CueKind,
  Scene,
  ShowData,
  VersionDiff,
  VersionSnapshot,
} from 'stage-cue-editor/models/show';
import { CUE_KINDS, OWNERS } from 'stage-cue-editor/models/show';

const STORAGE_KEY = 'sologsb-1013-stage-cue-editor-v1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function cue(
  id: string,
  kind: CueKind,
  title: string,
  duration: number,
  owner: string,
  extra: Partial<Cue> = {},
): Cue {
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
    { id: 'act-1', name: '第一幕', changeoverSeconds: 0 },
    { id: 'act-2', name: '第二幕', changeoverSeconds: 300 },
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
        cue('cue-light-1', '灯光', '观众席渐暗 · 面光起', 45, '李岚', {
          lighting: 'FOH 1 号面光 65%，侧光暖白 40%',
          notes: '开演铃后 10 秒执行',
        }),
        cue('cue-actor-1', '演员', '说书人自左台入场', 90, '赵一帆', {
          cast: ['说书人／周启'],
          props: ['折扇'],
          notes: '追光跟随；入场后停留台中',
        }),
        cue('cue-sound-1', '音响', '古琴引子淡入', 120, '陈默', {
          sound: 'Q1 古琴引子，-18dB 淡入 6 秒',
          dependsOn: ['cue-deleted-old'],
          notes: '旧版依赖保留用于检查示例',
        }),
        cue('cue-prop-1', '道具', '月牙灯升至舞台中线', 75, '孙禾', {
          props: ['月牙灯'],
          lighting: '顶排 3 号定点',
        }),
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
        cue('cue-stage-2', '舞台', '中景屏风换为朱红', 60, '', {
          notes: '负责人尚未确认',
        }),
        cue('cue-actor-2', '演员', '群臣列队入场', 110, '赵一帆', {
          cast: ['群演 6 人', '侍女 4 人'],
          props: ['宫灯'],
        }),
        cue('cue-light-2', '灯光', '暖金顶光覆盖后区', 80, '李岚', {
          lighting: '顶光 4、5 号 70%，色温 3200K',
        }),
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

/** 兼容旧版数据：幕还挂在场次上时，抽出成独立的幕表 */
function normalizeShow(data: Partial<ShowData> | undefined): ShowData {
  const fallback = initialShow();
  if (!data || !Array.isArray(data.scenes)) return fallback;
  const rawScenes = data.scenes as Array<Scene & { act?: string }>;
  if (Array.isArray(data.acts) && data.acts.length) {
    return {
      ...fallback,
      ...data,
      acts: data.acts,
      scenes: rawScenes,
    } as ShowData;
  }
  const names: string[] = [];
  rawScenes.forEach((scene) => {
    const name = scene.act ?? '第一幕';
    if (!names.includes(name)) names.push(name);
  });
  if (!names.length) names.push('第一幕');
  const acts: Act[] = names.map((name) => ({
    id: uid('act'),
    name,
    // 迁移数据不掌握真实换景节奏，先不预留，避免凭空报错
    changeoverSeconds: 0,
  }));
  const nameToAct = new Map(
    names.map((name, index) => [name, acts[index]!.id]),
  );
  const scenes: Scene[] = rawScenes.map((scene) => {
    const rest = { ...scene } as Partial<Scene> & { act?: string };
    delete rest.act;
    return {
      ...(rest as Scene),
      actId: scene.actId ?? nameToAct.get(scene.act ?? '') ?? acts[0]!.id,
    };
  });
  return { ...fallback, ...data, acts, scenes } as ShowData;
}

function loadShow(): ShowData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialShow();
    return normalizeShow((JSON.parse(raw) as { show: Partial<ShowData> }).show);
  } catch {
    return initialShow();
  }
}

function loadVersions(): VersionSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const versions =
      (JSON.parse(raw) as { versions: VersionSnapshot[] }).versions ?? [];
    return versions.map((version) => ({
      ...version,
      data: normalizeShow(version.data),
    }));
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

function clockLabel(totalSeconds: number): string {
  const total = ((totalSeconds % 86400) + 86400) % 86400;
  const hour = Math.floor(total / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return [hour, minute, second]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function timeLabel(scene: Scene, offset: number): string {
  return clockLabel(startSeconds(scene.startTime) + offset);
}

function sceneDuration(scene: Scene): number {
  return scene.cues.reduce(
    (total, item) => total + (Number(item.duration) || 0),
    0,
  );
}

function durationLabel(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  const hour = Math.floor(value / 3600);
  const minute = Math.floor((value % 3600) / 60);
  const second = value % 60;
  if (hour > 0)
    return `${hour} 时 ${String(minute).padStart(2, '0')} 分 ${String(second).padStart(2, '0')} 秒`;
  return `${String(minute).padStart(2, '0')} 分 ${String(second).padStart(2, '0')} 秒`;
}

function overlaps(
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
): boolean {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

export interface ActGroup {
  act: Act;
  scenes: SceneRow[];
  sceneCount: number;
  duration: number;
  durationLabel: string;
  changeoverIssue: ChangeoverIssue | null;
}

export interface SceneRow {
  id: string;
  name: string;
  title: string;
  startTime: string;
  locked: boolean;
  cues: Cue[];
  actId: string;
  active: boolean;
  issueCount: number;
  duration: number;
}

export interface ChangeoverIssue {
  id: string;
  actId: string;
  sceneId: string;
  /** 还缺多少秒换景；两幕时间重叠时为 null */
  shortfallSeconds: number | null;
  detail: string;
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

  get selectedCue(): Cue | undefined {
    return this.activeScene?.cues.find(
      (item) => item.id === this.selectedCueId,
    );
  }

  get cueRows() {
    if (!this.activeScene) return [];
    return this.activeScene.cues.map((item, index) => ({
      ...item,
      index,
      start: timeLabel(this.activeScene as Scene, item.offset),
      end: timeLabel(this.activeScene as Scene, item.offset + item.duration),
      selected: item.id === this.selectedCueId,
      hasIssue: this.cueIssues.some((issue) => issue.cueId === item.id),
      kindClass:
        item.kind === '灯光'
          ? 'light'
          : item.kind === '音响'
            ? 'sound'
            : item.kind === '道具'
              ? 'prop'
              : item.kind === '演员'
                ? 'cast'
                : item.kind === '字幕'
                  ? 'caption'
                  : 'stage',
      propsLabel: item.props.join('、'),
      castLabel: item.cast.join('、'),
    }));
  }

  get actGroups(): ActGroup[] {
    return this.show.acts.map((act) => {
      const scenes = this.show.scenes.filter((scene) => scene.actId === act.id);
      const rows: SceneRow[] = scenes.map((scene) => ({
        ...scene,
        active: scene.id === this.activeSceneId,
        issueCount: this.cueIssues.filter((issue) => issue.sceneId === scene.id)
          .length,
        duration: sceneDuration(scene),
      }));
      const duration = rows.reduce((total, scene) => total + scene.duration, 0);
      return {
        act,
        scenes: rows,
        sceneCount: rows.length,
        duration,
        durationLabel: durationLabel(duration),
        changeoverIssue:
          this.changeoverIssues.find((issue) => issue.actId === act.id) ?? null,
      };
    });
  }

  get filteredActGroups(): ActGroup[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.actGroups;
    return this.actGroups
      .map((group) => ({
        ...group,
        scenes: group.scenes.filter((scene) =>
          `${group.act.name}${scene.name}${scene.title}`
            .toLowerCase()
            .includes(term),
        ),
      }))
      .filter(
        (group) =>
          group.scenes.length > 0 ||
          group.act.name.toLowerCase().includes(term),
      );
  }

  get changeoverIssues(): ChangeoverIssue[] {
    const issues: ChangeoverIssue[] = [];
    for (let index = 1; index < this.show.acts.length; index += 1) {
      const previousAct = this.show.acts[index - 1]!;
      const currentAct = this.show.acts[index]!;
      const previousScenes = this.show.scenes.filter(
        (scene) => scene.actId === previousAct.id,
      );
      const currentScenes = this.show.scenes.filter(
        (scene) => scene.actId === currentAct.id,
      );
      if (!previousScenes.length || !currentScenes.length) continue;
      const previousEnd = Math.max(
        ...previousScenes.map(
          (scene) => startSeconds(scene.startTime) + sceneDuration(scene),
        ),
      );
      const currentStart = Math.min(
        ...currentScenes.map((scene) => startSeconds(scene.startTime)),
      );
      if (currentStart < previousEnd) {
        issues.push({
          id: `changeover-overlap-${currentAct.id}`,
          actId: currentAct.id,
          sceneId: currentScenes[0]!.id,
          shortfallSeconds: null,
          detail: `${previousAct.name}散场（${clockLabel(previousEnd)}）晚于${currentAct.name}开场（${clockLabel(currentStart)}），两幕时间重叠，无法完成 ${currentAct.changeoverSeconds} 秒换景。`,
        });
        continue;
      }
      const gap = currentStart - previousEnd;
      if (gap < currentAct.changeoverSeconds) {
        issues.push({
          id: `changeover-${currentAct.id}`,
          actId: currentAct.id,
          sceneId: currentScenes[0]!.id,
          shortfallSeconds: currentAct.changeoverSeconds - gap,
          detail: `${previousAct.name}散场（${clockLabel(previousEnd)}）到${currentAct.name}开场（${clockLabel(currentStart)}）只有 ${gap} 秒，本幕开场前需预留 ${currentAct.changeoverSeconds} 秒换景，还差 ${currentAct.changeoverSeconds - gap} 秒。`,
        });
      }
    }
    return issues;
  }

  get cueKindOptions(): CueKind[] {
    return CUE_KINDS;
  }

  get ownerOptions(): string[] {
    return OWNERS;
  }

  get allCues(): Array<{ cue: Cue; scene: Scene }> {
    return this.show.scenes.flatMap((scene) =>
      scene.cues.map((item) => ({ cue: item, scene })),
    );
  }

  private actName(actId: string): string {
    return this.show.acts.find((act) => act.id === actId)?.name ?? '未分幕';
  }

  get cueIssues(): CueIssue[] {
    const issues: CueIssue[] = [];
    this.allCues.forEach(({ cue: item, scene }) => {
      if (!item.owner) {
        issues.push({
          id: `owner-${item.id}`,
          severity: 'error',
          title: '负责人空缺',
          detail: `${this.actName(scene.actId)} ${scene.name}「${item.title}」尚未指定负责人。`,
          sceneId: scene.id,
          cueId: item.id,
        });
      }
      item.dependsOn.forEach((reference) => {
        if (!this.allCues.some((entry) => entry.cue.id === reference)) {
          issues.push({
            id: `ref-${item.id}-${reference}`,
            severity: 'error',
            title: '提示被引用但已删除',
            detail: `「${item.title}」仍依赖已删除的提示 ${reference}。`,
            sceneId: scene.id,
            cueId: item.id,
          });
        }
      });
      const previous = scene.cues[scene.cues.indexOf(item) - 1];
      if (previous && item.offset < previous.offset + previous.duration) {
        issues.push({
          id: `overlap-${item.id}`,
          severity: 'error',
          title: '同场时间冲突',
          detail: `「${item.title}」与上一条提示重叠。`,
          sceneId: scene.id,
          cueId: item.id,
        });
      }
    });

    const allCues = this.allCues;
    for (let index = 0; index < allCues.length; index += 1) {
      for (let next = index + 1; next < allCues.length; next += 1) {
        const left = allCues[index]!;
        const right = allCues[next]!;
        if (left.cue.id === right.cue.id || left.scene.id === right.scene.id)
          continue;
        const leftStart = startSeconds(left.scene.startTime) + left.cue.offset;
        const rightStart =
          startSeconds(right.scene.startTime) + right.cue.offset;
        if (
          !overlaps(
            leftStart,
            left.cue.duration,
            rightStart,
            right.cue.duration,
          )
        )
          continue;
        const sharedProps = left.cue.props.filter((value) =>
          right.cue.props.includes(value),
        );
        const sharedCast = left.cue.cast.filter((value) =>
          right.cue.cast.includes(value),
        );
        if (sharedProps.length) {
          issues.push({
            id: `prop-${left.cue.id}-${right.cue.id}`,
            severity: 'warning',
            title: '道具撞场',
            detail: `「${left.cue.title}」与「${right.cue.title}」同时使用：${sharedProps.join('、')}。`,
            sceneId: right.scene.id,
            cueId: right.cue.id,
          });
        }
        if (sharedCast.length) {
          issues.push({
            id: `cast-${left.cue.id}-${right.cue.id}`,
            severity: 'warning',
            title: '演员撞场',
            detail: `「${left.cue.title}」与「${right.cue.title}」同时需要：${sharedCast.join('、')}。`,
            sceneId: right.scene.id,
            cueId: right.cue.id,
          });
        }
      }
    }

    return issues.map((issue) => ({
      ...issue,
      icon: issue.severity === 'error' ? '!' : 'i',
    }));
  }

  /** 提示级检查 + 幕间换景检查，供检查面板与顶部阻塞数使用 */
  get issues(): CueIssue[] {
    const changeoverIssues: CueIssue[] = this.changeoverIssues.map(
      (changeover) => ({
        id: changeover.id,
        severity: 'error' as const,
        title: '幕间换景时间不足',
        detail: changeover.detail,
        sceneId: changeover.sceneId,
      }),
    );
    return [...this.cueIssues, ...changeoverIssues].map((issue) => ({
      ...issue,
      icon: issue.severity === 'error' ? '!' : 'i',
    }));
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
    return this.versions.find(
      (version) => version.id === this.compareVersionId,
    );
  }

  get versionDiff(): VersionDiff[] {
    const version = this.compareVersion;
    if (!version) return [];
    const labelOf = (data: ShowData) => (scene: Scene) => {
      const act =
        data.acts.find((item) => item.id === scene.actId)?.name ?? '未分幕';
      return (item: Cue) =>
        `${act}/${scene.name} · ${item.title} | ${item.owner || '未指定'} | ${item.duration}s`;
    };
    const before = version.data.scenes.flatMap((scene) =>
      scene.cues.map(labelOf(version.data)(scene)),
    );
    const after = this.show.scenes.flatMap((scene) =>
      scene.cues.map(labelOf(this.show)(scene)),
    );
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) => ({
        id: `diff-${index}`,
        changed: before[index] !== after[index],
        label: `提示 ${index + 1}`,
        before: before[index] ?? '—',
        after: after[index] ?? '—',
      }),
    );
  }

  @action
  selectScene(id: string): void {
    this.activeSceneId = id;
    this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
    this.draft = null;
  }

  @action
  focusIssue(issue: CueIssue): void {
    if (issue.sceneId && issue.sceneId !== this.activeSceneId)
      this.selectScene(issue.sceneId);
    if (issue.cueId) this.selectedCueId = issue.cueId;
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
    this.draft = {
      kind,
      title: '',
      duration: 60,
      owner: '',
      lighting: '',
      sound: '',
      props: '',
      cast: '',
      notes: '',
      dependsOn: '',
    };
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
        props: draft.props
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        cast: draft.cast
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        notes: draft.notes,
        dependsOn: draft.dependsOn
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
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
  addAct(): void {
    const act: Act = {
      id: uid('act'),
      name: `第${this.show.acts.length + 1}幕`,
      changeoverSeconds: 300,
    };
    this.mutate((show) => show.acts.push(act));
    this.notify('已新增一幕，可在组头修改幕名与开场前换景秒数');
  }

  @action
  updateActField(
    actId: string,
    field: 'name' | 'changeoverSeconds',
    value: string,
  ): void {
    this.mutate((show) => {
      const act = show.acts.find((item) => item.id === actId);
      if (!act) return;
      if (field === 'changeoverSeconds')
        act.changeoverSeconds = Math.max(0, Math.round(Number(value) || 0));
      else act.name = value;
    });
  }

  @action
  addScene(actId: string): void {
    const scene: Scene = {
      id: uid('scene'),
      actId,
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
  copyPreviousScene(): void {
    const index = this.show.scenes.findIndex(
      (scene) => scene.id === this.activeSceneId,
    );
    const previous = this.show.scenes[index - 1];
    if (!previous) {
      this.notify('当前已是第一场');
      return;
    }
    const copied: Scene = clone(previous);
    copied.id = uid('scene');
    copied.name = `${copied.name}-副本`;
    copied.title = `${copied.title}（复制）`;
    copied.cues = copied.cues.map((item) => ({
      ...item,
      id: uid('cue'),
      dependsOn: [],
    }));
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
      else if (field === 'props' || field === 'cast')
        item[field] = String(value)
          .split(/[、,，]/)
          .map((entry) => entry.trim())
          .filter(Boolean);
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
    this.mutate((show) =>
      show.scenes.forEach((scene) => {
        scene.locked = false;
      }),
    );
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
    if (!this.show.scenes.some((scene) => scene.id === this.activeSceneId))
      this.activeSceneId = this.show.scenes[0]?.id ?? '';
    if (!this.activeScene?.cues.some((item) => item.id === this.selectedCueId))
      this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
  }

  private persist(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ show: this.show, versions: this.versions }),
    );
  }

  private notify(value: string): void {
    this.message = value;
    window.setTimeout(() => {
      if (this.message === value) this.message = '';
    }, 2200);
  }

  private handleKeyboard = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const inEditor =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.tagName === 'SELECT';
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
