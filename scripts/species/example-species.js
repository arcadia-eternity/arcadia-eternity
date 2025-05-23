// 示例种族脚本 - 使用函数式API
import { Element } from '@arcadia-eternity/const';
import { declareSpecies } from '@arcadia-eternity/data-repository';
// 创建一个简单的Species对象
const ExampleSpecies = {
    id: 'example_species',
    num: 999,
    element: Element.Normal,
    baseStats: {
        hp: 100,
        atk: 80,
        def: 70,
        spa: 60,
        spd: 60,
        spe: 90,
    },
    genderRatio: [50, 50],
    heightRange: [1.0, 1.5],
    weightRange: [10, 20],
};
// 使用函数式API声明
declareSpecies(ExampleSpecies);
