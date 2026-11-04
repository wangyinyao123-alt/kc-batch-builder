import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../main';
import { TASK_TYPES, STATE_UI, normalizeKcPath, parseTitles, uid } from '../store';
import FolderPicker from '../components/FolderPicker';
import { Field, Hint } from '../components/Hint';
import { useRun } from '../hooks/useRun';
import RunResult from '../components/RunResult';

export default function NewTaskPage() {
  const { creds, settings, tasks, setTasks, setActiveTaskId, setRoute } = useApp();
  const [type, setType] = useState('import');
  const run = useRun();

  // 共用字段
  const [folderPath, setFolderPath] = useState('');
  const [autoCreateFolder, setAutoCreateFolder] = useState(true);

  // 导入图片
  const [imageDir, setImageDir] = useState('');
  const [importMode, setImportMode] = useState('Import');
  const [noCreate, setNoCreate] = useState(false);
  const [noBackup, setNoBackup] = useState(false);
  const [recurse, setRecurse] = useState(false);
  const [noIndex, setNoIndex] = useState(false);
  const [ignoreStateGate, setIgnoreStateGate] = useState(false);

  // 新建对象
  const [sourceKind, setSourceKind] = useState('titles'); // titles | xmlDir | mapXml
  const [sourceFile, setSourceFile] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [xmlDir, setXmlDir] = useState('');
  const [mapXmlFile, setMapXmlFile] = useState('');
  const [topicType, setTopicType] = useState('Task');
  const [mapMasterType, setMapMasterType] = useState('VMASTERTYPEUSERMANUALMAP');
  const [attachMap, setAttachMap] = useState('');
  const [attachPub, setAttachPub] = useState('');
  const [pubTitle, setPubTitle] = useState('');
  const [outputFormat, setOutputFormat] = useState('VOUTPUTFORMATPDF1-MANUAL-A4');
  const [pubSwitchMode, setPubSwitchMode] = useState('DISPLAY');

  const meta = TASK_TYPES[type];

  // 切换类型时重置来源模式
  useEffect(() => {
    if (type === 'topic') setSourceKind('titles');
    if (type === 'map') setSourceKind('titles');
  }, [type]);

  const titles = useMemo(() => parseTitles(sourceText, 'auto', sourceFile), [sourceText, sourceFile]);

  const pickDir = async (setter) => {
    const p = await window.kc.pickDir();
    if (p) setter(p);
  };
  const pickFile = async (setter, filters) => {
    const p = await window.kc.pickFile(filters);
    if (p) setter(p);
  };
  // 选标题清单文件时顺便读进 textarea
  const pickSourceFile = async () => {
    const p = await window.kc.pickFile([
      { name: '标题清单', extensions: ['txt', 'csv', 'md', 'markdown'] },
    ]);
    if (!p) return;
    setSourceFile(p);
    const r = await window.kc.readText(p);
    if (r.ok) setSourceText(r.text);
  };

  const params = useMemo(() => {
    const base = {
      user: creds.user,
      password: creds.password,
      wsBaseUrl: settings.wsBaseUrl,
      ignoreSsl: settings.ignoreSsl,
      folderPath: normalizeKcPath(folderPath),
      autoCreateFolder,
    };
    if (type === 'import') {
      return {
        ...base,
        imageDir,
        importMode,
        noCreate,
        noBackup,
        recurse,
        noIndex,
        ignoreStateGate,
      };
    }
    if (type === 'topic') {
      return {
        ...base,
        sourceKind,
        sourceFile,
        sourceText,
        xmlDir,
        topicType,
        attachMap,
      };
    }
    if (type === 'map') {
      return {
        ...base,
        sourceKind,
        sourceFile,
        sourceText,
        mapXmlFile,
        mapMasterType,
        attachPub: titles.length > 1 ? '' : attachPub,
      };
    }
    return {
      ...base,
      title: pubTitle,
      outputFormat,
      pubSwitchMode,
      languageCombination: 'zh-CN',
      languageElement: 'VLANGUAGEZHCN',
    };
  }, [
    type, creds, settings, folderPath, autoCreateFolder, imageDir, importMode, noCreate,
    noBackup, recurse, noIndex, ignoreStateGate, sourceKind, sourceFile, sourceText, xmlDir,
    topicType, attachMap, mapXmlFile, mapMasterType, attachPub, titles.length, pubTitle,
    outputFormat, pubSwitchMode,
  ]);

  const canPrecheck = useMemo(() => {
    if (!normalizeKcPath(folderPath)) return false;
    if (type === 'import') return Boolean(imageDir);
    if (type === 'pub') return Boolean(pubTitle.trim());
    if (sourceKind === 'xmlDir') return Boolean(xmlDir);
    if (sourceKind === 'mapXml') return Boolean(mapXmlFile);
    return titles.length > 0;
  }, [type, folderPath, imageDir, pubTitle, sourceKind, xmlDir, mapXmlFile, titles.length]);

  const doPrecheck = () => run.start({ taskType: type, params }, 'precheck');
  const doCommit = () => run.start({ taskType: type, params }, 'commit');

  // 把预检结果落成本地任务记录
  const saveTask = (statusOverride) => {
    const counts = run.summary?.precheck || {};
    const resultCounts = run.summary?.result || {};
    const id = uid();
    const rec = {
      id,
      type,
      typeName: meta.name,
      title: summarizeTitle(type, params, titles),
      folderPath: normalizeKcPath(folderPath),
      createdAt: Date.now(),
      status: statusOverride || (run.exitCode === 0 ? 'done' : 'failed'),
      counts: { ...counts, ...resultCounts },
      items: run.items,
      artifacts: run.artifacts,
      progress: run.progress,
      login: run.login,
      error: run.error,
      warns: run.warns,
      attach: run.attach,
      params,
    };
    setTasks((prev) => [rec, ...prev]);
    setActiveTaskId(id);
    return id;
  };

  const handleCommit = async () => {
    await doCommit();
  };

  const loginFailed = run.login && !run.login.ok;
  const precheckDone = run.phase === 'ready' || run.summary?.precheck;
  const commitDone = run.phase === 'done' && run.summary?.result;

  return (
    <div className="page-scroll">
      <div className="topbar" style={{ margin: '-24px -32px 24px', paddingLeft: 32, borderBottom: 'none' }}>
        <h1>新建任务</h1>
        <span className="crumb">选择任务类型 → 填写参数 → 预检 → 执行</span>
      </div>

      <div className="two-col">
        <div className="stack">
          {/* 类型选择 */}
          <section className="card card-pad">
            <h2 className="card-title">任务类型</h2>
            <div className="type-grid">
              {Object.values(TASK_TYPES).map((t) => {
                const disabled = t.key === 'pub' && false;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={`type-card ${type === t.key ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                    onClick={() => !disabled && setType(t.key)}
                  >
                    <div className="type-card-icon">{t.icon}</div>
                    <div className="type-card-name">{t.name}</div>
                    <div className="type-card-desc">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 参数表单 */}
          <section className="card card-pad">
            <h2 className="card-title">
              参数
              <span className="tag tag-pink" style={{ marginLeft: 'auto' }}>
                {meta.name}
              </span>
            </h2>

            <Field label="KC 目标目录" required hint={meta.folderHint}>
              <FolderPicker
                value={folderPath}
                onChange={setFolderPath}
                requiredType={meta.folderType}
                disabled={run.busy}
              />
            </Field>

            {type !== 'pub' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={autoCreateFolder}
                  disabled={run.busy}
                  onChange={(e) => setAutoCreateFolder(e.target.checked)}
                />
                <span>缺失的目录自动创建</span>
                <Hint text="勾选后，路径里不存在的层级会按需新建。中间层建成普通目录，最后一层带对象类型。" />
              </label>
            )}

            <div style={{ height: 16 }} />

            {type === 'import' && (
              <>
                <Field
                  label="本地图片文件夹"
                  required
                  hint="选择包含图片的本地目录。支持 png / jpg / svg / webp / eps 等格式。"
                >
                  <div className="row">
                    <input className="input grow mono" value={imageDir} readOnly placeholder="选择本地目录" />
                    <button className="btn" onClick={() => pickDir(setImageDir)} disabled={run.busy}>
                      选择
                    </button>
                  </div>
                </Field>

                <Field label="模式" hint="Import 只补 KC 里没有的；Update 会替换同名对象的内容（幂等，重复跑结果一样）。">
                  <div className="row gap16">
                    <label className="check">
                      <input
                        type="radio"
                        checked={importMode === 'Import'}
                        onChange={() => setImportMode('Import')}
                        disabled={run.busy}
                      />
                      <span>Import 只补缺失</span>
                    </label>
                    <label className="check">
                      <input
                        type="radio"
                        checked={importMode === 'Update'}
                        onChange={() => setImportMode('Update')}
                        disabled={run.busy}
                      />
                      <span>Update 替换同名</span>
                    </label>
                  </div>
                </Field>

                <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                  <label className={`check ${importMode !== 'Update' ? 'disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={noCreate}
                      disabled={run.busy || importMode !== 'Update'}
                      onChange={(e) => setNoCreate(e.target.checked)}
                    />
                    <span>只替换，不新建</span>
                  </label>
                  <label className={`check ${importMode !== 'Update' ? 'disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={noBackup}
                      disabled={run.busy || importMode !== 'Update'}
                      onChange={(e) => setNoBackup(e.target.checked)}
                    />
                    <span>不备份原图</span>
                    <Hint text="默认在替换前把原图备份到 backup\\时间戳\\ 并做哈希校验。只有确认不需要回滚时才勾选。" />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={recurse}
                      disabled={run.busy}
                      onChange={(e) => setRecurse(e.target.checked)}
                    />
                    <span>包含子文件夹</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={noIndex}
                      disabled={run.busy}
                      onChange={(e) => setNoIndex(e.target.checked)}
                    />
                    <span>不导出名称对照表</span>
                  </label>
                </div>
              </>
            )}

            {(type === 'topic' || type === 'map') && (
              <>
                <Field
                  label="标题来源"
                  hint={
                    type === 'topic'
                      ? '① XML 目录：递归读取本地 XML，标题取 <title>，类型按根元素自动判定（concept/task/reference）。\n② 标题清单：用内置空模板创建，每行一个标题。'
                      : '① 标题清单：用内置空 map 模板创建。\n② 本地 map XML：读取单文件，标题取 <title>，根元素须是 map/bookmap。'
                  }
                >
                  <div className="row gap16">
                    {type === 'topic' && (
                      <label className="check">
                        <input
                          type="radio"
                          checked={sourceKind === 'xmlDir'}
                          onChange={() => setSourceKind('xmlDir')}
                          disabled={run.busy}
                        />
                        <span>本地 XML 目录</span>
                      </label>
                    )}
                    {type === 'map' && (
                      <label className="check">
                        <input
                          type="radio"
                          checked={sourceKind === 'mapXml'}
                          onChange={() => setSourceKind('mapXml')}
                          disabled={run.busy}
                        />
                        <span>本地 map XML</span>
                      </label>
                    )}
                    <label className="check">
                      <input
                        type="radio"
                        checked={sourceKind === 'titles'}
                        onChange={() => setSourceKind('titles')}
                        disabled={run.busy}
                      />
                      <span>标题清单</span>
                    </label>
                  </div>
                </Field>

                {sourceKind === 'xmlDir' && (
                  <Field label="XML 目录" required hint="递归读取该目录下所有 XML。KC 侧会按本地子目录结构镜像建同名文件夹。">
                    <div className="row">
                      <input className="input grow mono" value={xmlDir} readOnly placeholder="选择包含 XML 的目录" />
                      <button className="btn" onClick={() => pickDir(setXmlDir)} disabled={run.busy}>
                        选择
                      </button>
                    </div>
                  </Field>
                )}

                {sourceKind === 'mapXml' && (
                  <Field label="map XML 文件" required hint="单个 .xml / .ditamap 文件，标题取其中的 <title>。">
                    <div className="row">
                      <input className="input grow mono" value={mapXmlFile} readOnly placeholder="选择 map XML" />
                      <button
                        className="btn"
                        onClick={() =>
                          pickFile(setMapXmlFile, [
                            { name: 'Map XML', extensions: ['xml', 'ditamap'] },
                          ])
                        }
                        disabled={run.busy}
                      >
                        选择
                      </button>
                    </div>
                  </Field>
                )}

                {sourceKind === 'titles' && (
                  <Field
                    label="标题清单"
                    required
                    hint="每行一个标题，或从 txt / csv / md 文件导入。csv 会自动找 Title/标题 列，md 取 # 标题行。"
                  >
                    <div className="row mb8">
                      <input
                        className="input grow mono"
                        value={sourceFile}
                        readOnly
                        placeholder="可选：从文件导入"
                      />
                      <button className="btn" onClick={pickSourceFile} disabled={run.busy}>
                        导入
                      </button>
                    </div>
                    <textarea
                      className="textarea"
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      disabled={run.busy}
                      placeholder={'任务一\n任务二\n概念概述'}
                    />
                    <div className="micro muted mt8">
                      已识别 <strong>{titles.length}</strong> 个标题
                      {titles.length > 0 && (
                        <span>（{titles.slice(0, 3).join('、')}{titles.length > 3 ? '…' : ''}）</span>
                      )}
                    </div>
                  </Field>
                )}

                {type === 'topic' && sourceKind === 'titles' && (
                  <Field label="Topic 类型" hint="空 topic 的默认类型。来源为 XML 目录时由根元素决定，此项不生效。">
                    <select
                      className="select"
                      value={topicType}
                      onChange={(e) => setTopicType(e.target.value)}
                      disabled={run.busy}
                    >
                      <option value="Task">Task（任务）</option>
                      <option value="Concept">Concept（概念）</option>
                      <option value="Reference">Reference（参考）</option>
                    </select>
                  </Field>
                )}

                {type === 'map' && (
                  <Field
                    label="Map 类型"
                    hint="决定 map 的 master type。选项从 KC 的 DMASTERTYPE 列表实时拉取，这里给的是内置兜底值。"
                  >
                    <select
                      className="select"
                      value={mapMasterType}
                      onChange={(e) => setMapMasterType(e.target.value)}
                      disabled={run.busy}
                    >
                      <option value="VMASTERTYPEUSERMANUALMAP">User Manual Map</option>
                      <option value="VMASTERTYPESPECIFICATIONMAP">Specification Map</option>
                    </select>
                  </Field>
                )}

                {type === 'topic' && (
                  <Field
                    label="创建后挂到 Map"
                    hint="可选。填 map 的 IshRef 或 GUID，创建完成后把新 topic 追加进该 map 的 topicref。写入前会强制备份 map XML 并做哈希校验。需 templates\\ 下有 map 样例。"
                  >
                    <input
                      className="input mono"
                      value={attachMap}
                      onChange={(e) => setAttachMap(e.target.value)}
                      disabled={run.busy}
                      placeholder="留空则不挂接"
                    />
                  </Field>
                )}

                {type === 'map' && (
                  <Field
                    label="创建后挂到 Pub"
                    hint="可选，仅单条 Map 可用（批量创建时不挂）。写入 pub 的 FISHMASTERREF。该接口尚未实测，建议先小批量验证。"
                  >
                    <input
                      className="input mono"
                      value={attachPub}
                      onChange={(e) => setAttachPub(e.target.value)}
                      disabled={run.busy || titles.length > 1}
                      placeholder={titles.length > 1 ? '批量创建时不支持挂 Pub' : '留空则不挂接'}
                    />
                  </Field>
                )}
              </>
            )}

            {type === 'pub' && (
              <>
                <Field label="标题" required hint="Publication 的标题。单个 pub 一条，不支持批量。">
                  <input
                    className="input"
                    value={pubTitle}
                    onChange={(e) => setPubTitle(e.target.value)}
                    disabled={run.busy}
                    placeholder="例如：DS-2CD2xxx 用户手册"
                  />
                </Field>

                <Field
                  label="输出格式"
                  hint="决定 Publication 的类型（VPUBLICATIONTYPE + 后缀）。完整的 OutputFormat 列表在脚本登录后从 KC 拉取。"
                >
                  <select
                    className="select"
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value)}
                    disabled={run.busy}
                  >
                    <option value="VOUTPUTFORMATPDF1-MANUAL-A4">PDF 手册 A4</option>
                    <option value="VOUTPUTFORMATPDF1-MANUAL-A5">PDF 手册 A5</option>
                    <option value="VOUTPUTFORMATHTML5-MANUAL">HTML5 手册</option>
                  </select>
                </Field>

                <Field
                  label="海康字段显示开关"
                  hint="海康的 8 个 Switch 字段（型号/功能/应用/场景/用户类型/客户端类型/产品类型/用户旅程）统一取值。全部填 DISPLAY 或全部填 HIDE。"
                >
                  <div className="row gap16">
                    <label className="check">
                      <input
                        type="radio"
                        checked={pubSwitchMode === 'DISPLAY'}
                        onChange={() => setPubSwitchMode('DISPLAY')}
                        disabled={run.busy}
                      />
                      <span>DISPLAY 显示</span>
                    </label>
                    <label className="check">
                      <input
                        type="radio"
                        checked={pubSwitchMode === 'HIDE'}
                        onChange={() => setPubSwitchMode('HIDE')}
                        disabled={run.busy}
                      />
                      <span>HIDE 隐藏</span>
                    </label>
                  </div>
                </Field>
              </>
            )}
          </section>
        </div>

        {/* 右栏：预检与执行 */}
        <div className="stack">
          <section className="card card-pad">
            <h2 className="card-title">预检与执行</h2>

            {!precheckDone && (
              <p className="card-desc">
                预检只读、零写入。确认清单没问题后再执行。
              </p>
            )}

            {loginFailed && (
              <div className="banner banner-error">
                <span>⚠</span>
                <span>
                  <strong>登录失败：</strong>
                  {run.login.error}
                </span>
              </div>
            )}

            {run.warns.length > 0 && (
              <div className="banner banner-warn">
                <span>⚠</span>
                <span>{run.warns[run.warns.length - 1]}</span>
              </div>
            )}

            {run.summary?.precheck && (
              <SummaryBlock counts={run.summary.precheck} taskType={type} />
            )}

            {run.summary?.result && (
              <div className="mt16">
                <div className="label" style={{ marginBottom: 8 }}>执行结果</div>
                <SummaryBlock counts={run.summary.result} taskType={type} isResult />
              </div>
            )}

            {run.busy && (
              <div className="mt16">
                <div className="flex between center micro muted mb8">
                  <span>
                    {run.phase === 'prechecking' ? '预检中' : '执行中'}
                    {run.progress.n > 0 ? ` · ${run.progress.i}/${run.progress.n}` : ''}
                  </span>
                  {run.progress.title && (
                    <span className="mono" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {run.progress.title}
                    </span>
                  )}
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill running"
                    style={{
                      width:
                        run.phase === 'prechecking'
                          ? '100%'
                          : run.progress.n
                          ? `${(run.progress.i / run.progress.n) * 100}%`
                          : '12%',
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt16" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {run.phase === 'idle' || run.phase === 'error' ? (
                <button className="btn btn-primary" onClick={doPrecheck} disabled={!canPrecheck || run.busy}>
                  开始预检
                </button>
              ) : null}

              {precheckDone && !commitDone && (
                <>
                  <button className="btn btn-primary" onClick={handleCommit} disabled={run.busy}>
                    {run.busy ? '执行中…' : '开始执行'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={run.reset} disabled={run.busy}>
                    重新填写
                  </button>
                </>
              )}

              {run.busy && (
                <button className="btn btn-danger btn-sm" onClick={run.cancel}>
                  中止
                </button>
              )}

              {commitDone && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      saveTask();
                      setRoute('tasks');
                    }}
                  >
                    保存到任务中心
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={run.reset}>
                    再建一个
                  </button>
                </>
              )}
            </div>

            {!canPrecheck && run.phase === 'idle' && (
              <p className="micro muted mt8" style={{ marginBottom: 0 }}>
                填完必填项后可预检
              </p>
            )}
          </section>

          {(run.items.length > 0 || run.events.length > 0) && (
            <RunResult run={run} />
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBlock({ counts, taskType, isResult }) {
  const c = counts || {};
  const cells = [
    { k: 'created', label: isResult ? '已创建' : '待创建', cls: 'create' },
    { k: 'skipped', label: '跳过', cls: 'skip' },
    { k: 'blocked', label: '阻塞', cls: 'block' },
    { k: 'failed', label: '失败', cls: 'fail' },
  ];
  return (
    <div className="metric-grid">
      {cells.map((cell) => {
        const v = c[cell.k];
        if (v == null && isResult) return null;
        return (
          <div key={cell.k} className={`metric ${cell.cls}`}>
            <div className="metric-num">{v ?? 0}</div>
            <div className="metric-label">{cell.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function summarizeTitle(type, params, titles) {
  if (type === 'pub') return params.title || '未命名 Publication';
  if (type === 'import') {
    const seg = (params.imageDir || '').split(/[\\/]/).filter(Boolean).pop();
    return `导入图片 · ${seg || '未选择目录'}`;
  }
  if (params.sourceKind === 'xmlDir') {
    const seg = (params.xmlDir || '').split(/[\\/]/).filter(Boolean).pop();
    return `新建 Topic · ${seg || 'XML 目录'}`;
  }
  if (params.sourceKind === 'mapXml') {
    const seg = (params.mapXmlFile || '').split(/[\\/]/).filter(Boolean).pop();
    return `新建 Map · ${seg || 'map XML'}`;
  }
  const n = titles.length;
  const head = titles[0] || '';
  return `${TASK_TYPES[type].name} · ${head}${n > 1 ? ` 等 ${n} 项` : ''}`;
}
