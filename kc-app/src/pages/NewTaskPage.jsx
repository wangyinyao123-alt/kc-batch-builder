import React, { useState, useMemo, useEffect } from 'react';
import { ErrorDialog } from '../components/KcDialog';
import { useApp } from '../main';
import { TASK_TYPES, STATE_UI, normalizeKcPath, parseTitles, uid } from '../store';
import FolderPicker from '../components/FolderPicker';
import { Field, Hint } from '../components/Hint';
import { useRun } from '../hooks/useRun';
import RunResult from '../components/RunResult';

export default function NewTaskPage() {
  const { creds, settings, tasks, setTasks, setActiveTaskId, setRoute, routePayload } = useApp();
  const [type, setType] = useState('import');
  const run = useRun();

  // 「只重试失败项」：从 P4 详情页带过来的失败标题
  useEffect(() => {
    if (!routePayload || !routePayload.titles) return;
    const from = routePayload.from;
    if (from) {
      setType(from.type);
      setFolderPath(from.folderPath || '');
      const p = from.params || {};
      if (p.xmlDir) setXmlDir(p.xmlDir);
    }
    setSourceKind('titles');
    setSourceText(routePayload.titles.join('\n'));
    // 只在带 payload 进入时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePayload]);

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
      results: run.results,
      events: run.events,
      summary: run.summary,
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
  const [showErr, setShowErr] = useState(false);
  const precheckDone = run.phase === 'ready' || run.summary?.precheck;
  const commitDone = run.phase === 'done' && run.summary?.result;

  // 当前类型是否已配置完整（用于「预检」按钮态与提示条）
  const readyMsg = canPrecheck ? '信息完整，可以预检' : '还差必填项，填完可预检';

  // 缺哪些必填项 —— 提示条右侧要如实说缺什么。
  // 早先这里是无条件显示「目录、目标路径与图片文件夹均已配置」，
  // 于是和左边那句「还差必填项」自相矛盾（UI 上同时出现两句互斥文案）。
  const missing = useMemo(() => {
    const out = [];
    if (!normalizeKcPath(folderPath)) out.push('KC 仓库目标路径');
    if (type === 'import') {
      if (!imageDir) out.push('本地图片文件夹');
    } else if (type === 'pub') {
      if (!pubTitle.trim()) out.push('Pub 标题');
    } else if (sourceKind === 'xmlDir') {
      if (!xmlDir) out.push('XML 目录');
    } else if (sourceKind === 'mapXml') {
      if (!mapXmlFile) out.push('Map XML 文件');
    } else if (!titles.length) {
      out.push('标题清单');
    }
    return out;
  }, [type, folderPath, imageDir, pubTitle, sourceKind, xmlDir, mapXmlFile, titles.length]);

  // 已配齐时按类型给出确认语
  const configuredNote = useMemo(() => {
    if (type === 'import') return '目录、目标路径与图片文件夹均已配置';
    if (type === 'pub') return '标题、落点路径与输出格式均已配置';
    if (sourceKind === 'xmlDir') return 'XML 目录与落点路径均已配置';
    if (sourceKind === 'mapXml') return 'Map XML 与落点路径均已配置';
    return '标题、落点路径与类型均已配置';
  }, [type, sourceKind]);

  const readyNote = missing.length ? `缺少：${missing.join('、')}` : configuredNote;

  // 各类型的参数按「左栏 / 右栏」拆分（DSL：两栏各 560，节距 30）
  const renderLeft = () => {
    if (type === 'import') {
      return (
        <>
          <div className="p3-label">本地图片文件夹<span className="req">*</span>
            <Hint text="选择包含图片的本地目录。支持 png / jpg / svg / webp / eps 等格式。" />
          </div>
          <div className="p3-filecard">
            <div className="p3-filedrop">
              <div className="p3-fileicon">DIR</div>
              <div className="p3-filemeta">
                <div className="p3-filename">{imageDir || '尚未选择目录'}</div>
                <div className="p3-fileinfo">
                  {imageDir ? '已选择本地目录' : '点右侧按钮选择一个本地文件夹'}
                </div>
              </div>
              <button className="p3-reselect" onClick={() => pickDir(setImageDir)} disabled={run.busy}>
                选择目录
              </button>
            </div>
          </div>
        </>
      );
    }

    if (type === 'pub') {
      return (
        <>
          <div className="p3-label">Publication 标题<span className="req">*</span>
            <Hint text="Publication 的标题。单个 pub 一条，不支持批量。" />
          </div>
          <div className="p3-filecard">
            <div className="p3-filedrop">
              <div className="p3-fileicon">PUB</div>
              <div className="p3-filemeta">
                <div className="p3-filename">{pubTitle || '尚未填写标题'}</div>
                <div className="p3-fileinfo">Publication 标题</div>
              </div>
            </div>
          </div>
          <input
            className="p3-input mt10"
            value={pubTitle}
            onChange={(e) => setPubTitle(e.target.value)}
            disabled={run.busy}
            placeholder="例如：DS-2CD2xxx 用户手册"
          />
        </>
      );
    }

    return (
      <>
        <div className="p3-label">内容来源
          <Hint
            text={
              type === 'topic'
                ? '① XML 目录：递归读取本地 XML，标题取 <title>，类型按根元素自动判定（concept/task/reference）。\n② 标题清单：用内置空模板创建，每行一个标题。'
                : '① 标题清单：用内置空 map 模板创建。\n② 本地 map XML：读取单文件，标题取 <title>，根元素须是 map/bookmap。'
            }
          />
        </div>
        <div className="p3-formats">
          {type === 'topic' && (
            <label className={`p3-format ${sourceKind === 'xmlDir' ? 'on' : ''}`}>
              <input type="radio" checked={sourceKind === 'xmlDir'} onChange={() => setSourceKind('xmlDir')} disabled={run.busy} />
              <span>本地 XML 目录</span>
            </label>
          )}
          {type === 'map' && (
            <label className={`p3-format ${sourceKind === 'mapXml' ? 'on' : ''}`}>
              <input type="radio" checked={sourceKind === 'mapXml'} onChange={() => setSourceKind('mapXml')} disabled={run.busy} />
              <span>本地 map XML</span>
            </label>
          )}
          <label className={`p3-format ${sourceKind === 'titles' ? 'on' : ''}`}>
            <input type="radio" checked={sourceKind === 'titles'} onChange={() => setSourceKind('titles')} disabled={run.busy} />
            <span>标题清单</span>
          </label>
        </div>

        {sourceKind === 'xmlDir' && (
          <div className="p3-filecard mt10">
            <div className="p3-filedrop">
              <div className="p3-fileicon">XML</div>
              <div className="p3-filemeta">
                <div className="p3-filename">{xmlDir || '尚未选择目录'}</div>
                <div className="p3-fileinfo">{xmlDir ? '已选择 XML 目录' : '递归读取该目录下所有 XML'}</div>
              </div>
              <button className="p3-reselect" onClick={() => pickDir(setXmlDir)} disabled={run.busy}>
                选择目录
              </button>
            </div>
          </div>
        )}

        {sourceKind === 'mapXml' && (
          <div className="p3-filecard mt10">
            <div className="p3-filedrop">
              <div className="p3-fileicon">MAP</div>
              <div className="p3-filemeta">
                <div className="p3-filename">{mapXmlFile || '尚未选择文件'}</div>
                <div className="p3-fileinfo">{mapXmlFile ? '已选择 map XML' : '单个 .xml / .ditamap 文件'}</div>
              </div>
              <button
                className="p3-reselect"
                onClick={() => pickFile(setMapXmlFile, [{ name: 'Map XML', extensions: ['xml', 'ditamap'] }])}
                disabled={run.busy}
              >
                选择文件
              </button>
            </div>
          </div>
        )}

        {sourceKind === 'titles' && (
          <>
            <div className="p3-filecard mt10">
              <div className="p3-filedrop">
                <div className="p3-fileicon">TXT</div>
                <div className="p3-filemeta">
                  <div className="p3-filename">{sourceFile || '直接从下方输入'}</div>
                  <div className="p3-fileinfo">已识别 {titles.length} 个标题</div>
                </div>
                <button className="p3-reselect" onClick={pickSourceFile} disabled={run.busy}>
                  导入文件
                </button>
              </div>
            </div>
            <textarea
              className="p3-textarea mt10"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              disabled={run.busy}
              placeholder={'任务一\n任务二\n概念概述'}
            />
            <div className="p3-micro mt6">
              已识别 <strong>{titles.length}</strong> 个标题
              {titles.length > 0 && (
                <span>（{titles.slice(0, 3).join('、')}{titles.length > 3 ? '…' : ''}）</span>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  const renderRight = () => {
    if (type === 'import') {
      return (
        <>
          <div className="p3-label">模式
            <Hint text="Import 只补 KC 里没有的；Update 会替换同名对象的内容（幂等，重复跑结果一样）。" />
          </div>
          <div className="p3-opts">
            <label className={`p3-opt ${importMode === 'Import' ? 'on' : ''}`}>
              <input type="radio" checked={importMode === 'Import'} onChange={() => setImportMode('Import')} disabled={run.busy} />
              <span>Import 只补缺失</span>
            </label>
            <label className={`p3-opt ${importMode === 'Update' ? 'on' : ''}`}>
              <input type="radio" checked={importMode === 'Update'} onChange={() => setImportMode('Update')} disabled={run.busy} />
              <span>Update 替换同名</span>
            </label>
          </div>
          <div className="p3-checks">
            <label className={`p3-check ${importMode !== 'Update' ? 'off' : ''}`}>
              <input type="checkbox" checked={noCreate} disabled={run.busy || importMode !== 'Update'} onChange={(e) => setNoCreate(e.target.checked)} />
              <span>只替换，不新建</span>
            </label>
            <label className={`p3-check ${importMode !== 'Update' ? 'off' : ''}`}>
              <input type="checkbox" checked={noBackup} disabled={run.busy || importMode !== 'Update'} onChange={(e) => setNoBackup(e.target.checked)} />
              <span>不备份原图</span>
              <Hint text="默认在替换前把原图备份到 backup\时间戳\ 并做哈希校验。只有确认不需要回滚时才勾选。" />
            </label>
            <label className="p3-check">
              <input type="checkbox" checked={recurse} disabled={run.busy} onChange={(e) => setRecurse(e.target.checked)} />
              <span>包含子文件夹</span>
            </label>
            <label className="p3-check">
              <input type="checkbox" checked={noIndex} disabled={run.busy} onChange={(e) => setNoIndex(e.target.checked)} />
              <span>不导出名称对照表</span>
            </label>
          </div>
        </>
      );
    }

    if (type === 'pub') {
      return (
        <>
          <div className="p3-label">发布输出格式
            <Hint text="决定 Publication 的类型（VPUBLICATIONTYPE + 后缀）。完整的 OutputFormat 列表在脚本登录后从 KC 拉取。" />
          </div>
          <div className="p3-formats">
            {[
              { v: 'VOUTPUTFORMATPDF1-MANUAL-A4', t: 'PDF 手册 A4' },
              { v: 'VOUTPUTFORMATPDF1-MANUAL-A5', t: 'PDF 手册 A5' },
              { v: 'VOUTPUTFORMATHTML5-MANUAL', t: 'HTML 手册' },
            ].map((f) => (
              <label key={f.v} className={`p3-format ${outputFormat === f.v ? 'on' : ''}`}>
                <input type="radio" checked={outputFormat === f.v} onChange={() => setOutputFormat(f.v)} disabled={run.busy} />
                <span>{f.t}</span>
              </label>
            ))}
          </div>
          <div className="p3-checks">
            <label className={`p3-check ${pubSwitchMode === 'DISPLAY' ? '' : 'off'}`}>
              <input type="radio" checked={pubSwitchMode === 'DISPLAY'} onChange={() => setPubSwitchMode('DISPLAY')} disabled={run.busy} />
              <span>字段显示 DISPLAY</span>
            </label>
            <label className={`p3-check ${pubSwitchMode === 'HIDE' ? '' : 'off'}`}>
              <input type="radio" checked={pubSwitchMode === 'HIDE'} onChange={() => setPubSwitchMode('HIDE')} disabled={run.busy} />
              <span>字段隐藏 HIDE</span>
              <Hint text="海康的 8 个 Switch 字段（型号/功能/应用/场景/用户类型/客户端类型/产品类型/用户旅程）统一取值，全部 DISPLAY 或全部 HIDE。" />
            </label>
          </div>
        </>
      );
    }

    // topic / map 的类型与挂接
    return (
      <>
        {type === 'topic' && sourceKind === 'titles' && (
          <>
            <div className="p3-label">Topic 类型
              <Hint text="空 topic 的默认类型。来源为 XML 目录时由根元素决定，此项不生效。" />
            </div>
            <select className="p3-select" value={topicType} onChange={(e) => setTopicType(e.target.value)} disabled={run.busy}>
              <option value="Task">Task（任务）</option>
              <option value="Concept">Concept（概念）</option>
              <option value="Reference">Reference（参考）</option>
            </select>
          </>
        )}

        {type === 'map' && (
          <>
            <div className="p3-label">Map 类型
              <Hint text="决定 map 的 master type。选项从 KC 的 DMASTERTYPE 列表实时拉取，这里给的是内置兜底值。" />
            </div>
            <select className="p3-select" value={mapMasterType} onChange={(e) => setMapMasterType(e.target.value)} disabled={run.busy}>
              <option value="VMASTERTYPEUSERMANUALMAP">User Manual Map</option>
              <option value="VMASTERTYPESPECIFICATIONMAP">Specification Map</option>
            </select>
            <div className="p3-label mt18">创建后挂到 Pub
              <Hint text="可选，仅单条 Map 可用（批量创建时不挂）。写入 pub 的 FISHMASTERREF。该接口尚未实测，建议先小批量验证。" />
            </div>
            <input
              className="p3-input"
              value={attachPub}
              onChange={(e) => setAttachPub(e.target.value)}
              disabled={run.busy || titles.length > 1}
              placeholder={titles.length > 1 ? '批量创建时不支持挂 Pub' : '留空则不挂接'}
            />
          </>
        )}

        {type === 'topic' && (
          <>
            <div className="p3-label mt18">创建后挂到 Map
              <Hint text="可选。填 map 的 IshRef 或 GUID，创建完成后把新 topic 追加进该 map 的 topicref。写入前会强制备份 map XML 并做哈希校验。需 templates\ 下有 map 样例。" />
            </div>
            <input
              className="p3-input"
              value={attachMap}
              onChange={(e) => setAttachMap(e.target.value)}
              disabled={run.busy}
              placeholder="留空则不挂接"
            />
          </>
        )}
      </>
    );
  };

  return (
    <div className="page-scroll p3-scroll">
      {/* 面包屑 + 标题 + 说明 + 返回（DSL：10px 面包屑，25px 标题，12px 说明） */}
      <div className="p3-crumb">PIXEL WORKSPACE / TASKS</div>
      <div className="p3-titlerow">
        <h1 className="p3-title">新建任务</h1>
        <span className="p3-sub">配置发布框架，一次完成批量建库</span>
        <span className="p3-back" onClick={() => setRoute('tasks')}>← 返回任务</span>
      </div>

      {/* 类型卡：4 × 278×86，节距 290 */}
      <div className="p3-types">
        {Object.values(TASK_TYPES).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`p3-type ${type === t.key ? 'on' : ''}`}
            onClick={() => setType(t.key)}
          >
            {type === t.key && <span className="p3-cur">当前选择</span>}
            <span className="p3-typeicon">
              {t.sticker ? <img src={t.sticker} alt="" /> : t.icon}
            </span>
            <span className="p3-typename">{t.name}</span>
            <span className="p3-typedesc">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* KC 仓库目标路径：1150×50 */}
      <div className="p3-label mt14">KC 仓库目标路径<span className="req">*</span>
        <Hint text={meta.folderHint} />
      </div>
      <div className="p3-pathbox">
        <span className="p3-slash">/</span>
        <input
          className="p3-pathinput"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          disabled={run.busy}
          placeholder="kc-repository\医疗\呼吸机\..."
        />
        <FolderPicker
          value={folderPath}
          onChange={setFolderPath}
          requiredType={meta.folderType}
          disabled={run.busy}
          bare
        />
        <span className={`p3-valid ${normalizeKcPath(folderPath) ? 'on' : ''}`}>
          {normalizeKcPath(folderPath) ? '✓ 路径有效' : '· 待填写'}
        </span>
      </div>
      {/* 目录树浏览：DSL 无此块，收成路径框内的「浏览仓库」触发器 */}
      {type !== 'pub' && (
        <label className="p3-check mt8">
          <input type="checkbox" checked={autoCreateFolder} disabled={run.busy} onChange={(e) => setAutoCreateFolder(e.target.checked)} />
          <span>缺失的目录自动创建</span>
          <Hint text="勾选后，路径里不存在的层级会按需新建。中间层建成普通目录，最后一层带对象类型。" />
        </label>
      )}

      {/* 中部内容：左栏参数 560，右栏参数 560 */}
      <div className="p3-cols">
        <div className="p3-col">{renderLeft()}</div>
        <div className="p3-col">{renderRight()}</div>
      </div>

      {/* 预检与执行：仅在有活动时占位，空闲时高度为 0，与 DSL 空态一致 */}
      {(run.busy || run.summary?.precheck || run.summary?.result || run.items.length > 0 || run.events.length > 0 || run.warns.length > 0 || loginFailed) && (
        <div className="p3-run">
          <div className="p3-label">
            预检与执行
            <Hint text="预检只读、零写入。确认清单没问题后再执行。" />
          </div>

          {loginFailed && (
            <div className="p3-banner err">
              <strong>登录失败：</strong>
              {run.login.error}
              <button className="p3-banner-more" onClick={() => setShowErr(true)}>
                查看详情
              </button>
            </div>
          )}

          {run.warns.length > 0 && <div className="p3-banner warn">{run.warns[run.warns.length - 1]}</div>}

          {run.summary?.precheck && (
            <div className="p3-metrics">
              <SummaryBlock counts={run.summary.precheck} taskType={type} />
            </div>
          )}

          {run.summary?.result && (
            <>
              <div className="p3-label mt14">执行结果</div>
              <div className="p3-metrics">
                <SummaryBlock counts={run.summary.result} taskType={type} isResult />
              </div>
            </>
          )}

          {run.busy && (
            <div className="mt12">
              <div className="p3-micro between">
                <span>
                  {run.phase === 'prechecking' ? '预检中' : '执行中'}
                  {run.progress.n > 0 ? ` · ${run.progress.i}/${run.progress.n}` : ''}
                </span>
                {run.progress.title && <span className="p3-ellipsis">{run.progress.title}</span>}
              </div>
              <div className="p3-bar mt6">
                <div
                  className="p3-barfill"
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

          {(run.items.length > 0 || run.events.length > 0) && (
            <div className="mt14">
              <RunResult run={run} />
            </div>
          )}
        </div>
      )}

      {/* 配置就绪条：1150×42 */}
      <div className={`p3-ready ${canPrecheck ? 'ok' : 'wait'}`}>
        <span className="p3-readydot" />
        <span className="p3-readymain">{readyMsg}</span>
        <span className="p3-readynote">{readyNote}</span>
      </div>

      {/* 操作区：分隔线 + 状态说明 + 预检 118×44 + 开始执行 132×50 */}
      <div className="p3-divider" />
      <div className="p3-actions">
        <span className="p3-statusline">
          {TASK_TYPES[type].name} · {canPrecheck ? '已就绪' : '待配置'}
          <span className="p3-dotsep">　</span>
          {precheckDone ? '预检通过，可以执行' : '检查配置后开始执行'}
        </span>
        {run.phase === 'idle' || run.phase === 'error' ? (
          <button className="p3-btn-pre" onClick={doPrecheck} disabled={!canPrecheck || run.busy}>
            预检
          </button>
        ) : null}
        {precheckDone && !commitDone ? (
          <>
            <button className="p3-btn-go" onClick={handleCommit} disabled={run.busy}>
              {run.busy ? '执行中…' : '开始执行 →'}
            </button>
            <button className="p3-btn-ghost" onClick={run.reset} disabled={run.busy}>
              重新填写
            </button>
          </>
        ) : null}
        {run.busy && (
          <button className="p3-btn-ghost danger" onClick={run.cancel}>
            中止
          </button>
        )}
        {commitDone && (
          <>
            <button
              className="p3-btn-go"
              onClick={() => {
                saveTask();
                setRoute('tasks');
              }}
            >
              保存到任务中心 →
            </button>
            <button className="p3-btn-ghost" onClick={run.reset}>
              再建一个
            </button>
          </>
        )}
        {!precheckDone && !run.busy && (
          <button className="p3-btn-go" disabled>
            开始执行 →
          </button>
        )}
      </div>

      {showErr && loginFailed && (
        <ErrorDialog
          title="无法连接 KC 服务器"
          reason={`${run.login.error}。请确认地址、网络与账号后重试。`}
          codeLabel={run.login.code ? `${run.login.code} · 连接失败` : 'E101 · 连接失败'}
          path={settings?.wsBaseUrl || 'https://kc-prod.hikvision.com/ISHWS/'}
          onCopy={() => {
            const txt = `${run.login.code || 'E101'} | ${run.login.error} | ${settings?.wsBaseUrl || ''}`;
            navigator.clipboard?.writeText(txt);
            setShowErr(false);
          }}
          onClose={() => setShowErr(false)}
        />
      )}
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
