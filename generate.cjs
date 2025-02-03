// generate-type-chart.js 修复版
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// 增强版中文映射表
const TYPE_MAP = Object.freeze({
    '普通': 'Normal',
    '草': 'Grass',
    '水': 'Water',
    '火': 'Fire',
    '风': 'Wind',
    '虫': 'Bug',
    '飞行': 'Flying',
    '电': 'Electric',
    '地面': 'Ground',
    '冰': 'Ice',
    '超能': 'Psychic',
    '战斗': 'Fighting',
    '特质': 'Trait',
    '光': 'Light',
    '神秘': 'Mystery',
    '暗影': 'Shadow',
    '龙': 'Dragon',
    '沙漠': 'Desert',
    '上古': 'Ancient',
    '神遁': 'Divine',
    '神迹': 'Miracle',
    '圣灵': 'Holy',
    '精灵王': 'ElfKing'
});

// 严格值解析
const parseValue = (val) => {
    const cleaned = String(val).trim();
    if (cleaned === '?') return 0.75;
    const num = parseFloat(cleaned);
    return isNaN(num) ? 1 : num;
};

// 生成器增强：包含类型校验
function generateTypeChart(rows) {
    let output = 'export const TYPE_CHART: Record<Type, Record<Type, number>> = {\n';

    rows.forEach((row, index) => {
        // 清洗攻击类型
        const attackerCN = String(row['↓攻/防→']).trim();
        const attacker = TYPE_MAP[attackerCN];
        if (!attacker) throw new Error(`第 ${index + 1} 行: 未知攻击类型 "${attackerCN}"`);

        // 处理防御类型
        const entries = [];
        for (const [defenseCN, value] of Object.entries(row)) {
            if (defenseCN === '↓攻/防→') continue;

            const defenseType = String(defenseCN).trim();
            const defender = TYPE_MAP[defenseType];
            if (!defender) throw new Error(`第 ${index + 1} 行: 未知防御类型 "${defenseType}"`);

            entries.push(`[Type.${defender}]: ${parseValue(value)}`);
        }

        // 校验完整性
        if (entries.length !== Object.keys(TYPE_MAP).length) {
            throw new Error(`第 ${index + 1} 行: 缺少防御类型定义`);
        }

        output += `  [Type.${attacker}]: {\n    ${entries.join(',\n    ')}\n  }${index < rows.length - 1 ? ',' : ''}\n`;
    });

    return output + '};';
}
let rows = []

// 主流程增强
fs.createReadStream(path.join(__dirname, '属性表.csv'))
    .pipe(csv({
        mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '') // 处理BOM
    }))
    .on('data', (row) => rows.push(row))
    .on('end', () => {
        try {
            // 生成枚举类型
            const enumCode = `export enum Type {\n  ${Object.values(TYPE_MAP).join(',\n  ')}\n}`;

            // 生成相克表
            const chartCode = generateTypeChart(rows);

            // 写入文件
            const output = `// 自动生成于 ${new Date().toISOString()}\n${enumCode}\n\n${chartCode}`;
            fs.writeFileSync('type-chart.generated.ts', output);
            console.log('成功生成属性相克表！');
        } catch (error) {
            console.error('生成失败:', error.message);
            process.exit(1);
        }
    })
    .on('error', (error) => {
        console.error('CSV解析错误:', error);
        process.exit(1);
    });