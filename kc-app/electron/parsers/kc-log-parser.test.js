// 解析器自测：node electron/parsers/kc-log-parser.test.js
const { parseLine, createParserState } = require('./kc-log-parser');

const IMPORT_LOG = `STEP 1  登录 KC
[..] 第 1 级 标准校验登录…
[OK] 登录成功：ISHRemote 9.0.0 / 账号 zhangsan
STEP 2  收集本地图片
STEP 3  落点解析
[OK] 目标目录最深已存在：General\\demo\\image（3/3 层）FolderId=10087 type=ISHIllustration
STEP 4  预检（只读）
[预检] 新建 3 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 0 / 共 4
    TOCREATE  cover.png [1920x1080] <EDTPNG> <General\\demo\\image\\cover.png>
    UNCHANGED sticker-01.png <EDTPNG> <General\\demo\\image\\sticker-01.png>
STEP 5  执行
[1/3] cover.png  —— 建成 ObjectRef=GUID-COVER
[2/3] logo.svg  —— 建成 ObjectRef=GUID-LOGO
[3/3] bulb.webp  —— 失败：[-129] InvalidDocTypeforFolder
STEP 6  台账
[OK] 台账追加 2 行，累计 128 行：logs\\kc-import-ledger.csv
STEP 7  结果
[结果] 新建 2 / 更新 0 / 无变化 1 / 跳过 0 / 阻塞 0 / 失败 1 / 共 4
[OK] 对照表已写出：logs\\demo_GUID_20261103-1600.csv
transcript : logs\\kc-import-20261103-160000.txt`;

const CREATE_LOG = `STEP 1  登录 KC
[OK] 登录成功：ISHRemote 9.0.0 / 账号 lisi
[OK] 清单 3 项（Topic 3 / Map 0 / Pub 0）
STEP 4  预检（只读）
[预检] 将创建 3 / 跳过 0 / 阻塞 0 / 失败 0 / 共 3
    TOCREATE Topic:TASK 任务一  <General\\demo\\任务一>  (将新建)
    TOCREATE Topic:CONCEPT 概念一  <General\\demo\\概念一>  (将新建)
[OK] 目标目录最深已存在：General\\demo（2/2 层）FolderId=10088 type=ISHModule
[OK] 挂接目标 map：测试map（GUID-58AD，现有 topicref 3 个，样例 sample-map-basic.ditamap）
STEP 5  执行
[1/3] 任务一  —— 建成 ObjectRef=GUID-T1 IshRef=ISH-T1  落点 FolderId=10088
[2/3] 任务二  —— 建成 ObjectRef=GUID-T2 IshRef=ISH-T2  落点 FolderId=10088
[3/3] 概念一  —— 建成 ObjectRef=GUID-T3 IshRef=ISH-T3  落点 FolderId=10088
[OK] 回读 FolderId=10088：本轮 3 个，未见 0 个
STEP 5b  挂接
[BK] 已备份 map XML：backup\\20261103-1600\\GUID-58AD.ditamap
[OK] 已写入 map：测试map（追加 topicref 3 个）
[OK] 回读校验通过：topicref 3 → 6
STEP 6  台账
[OK] 台账追加 3 行，累计 12 行：logs\\kc-create-ledger.csv
STEP 7  结果
transcript : logs\\kc-create-20261103-160000.txt`;

const KCJSON_LINE =
  'KCJSON {"path":"General\\\\demo","resolved":true,"leaf":"demo","missing":[],"folderType":"ISHModule","folderId":"10088","children":[{"name":"image","id":"10087","type":"ISHIllustration"}]}';

function run(title, log, taskType) {
  console.log(`\n=== ${title} ===`);
  const st = createParserState(taskType);
  for (const line of log.split('\n')) {
    for (const evt of parseLine(line, st)) {
      console.log(JSON.stringify(evt));
    }
  }
  console.log('--- summary:', JSON.stringify(st.summary));
}

run('import', IMPORT_LOG, 'import');
run('create(topic)', CREATE_LOG, 'topic');
run('listFolders', KCJSON_LINE, 'topic');
