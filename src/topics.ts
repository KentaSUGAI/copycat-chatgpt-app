// 内蔵カード本体は public/topics.js に置き、全プレイヤーが自分の言語で
// 同じインデックスの単語を表示する。サーバーはカードIDと秘密語の
// インデックスだけを保持するため、0トークンかつ言語に依存しない。
// public/topics.js の TOPICS 数を変更した場合はこの値も更新する。
export const BUILTIN_TOPIC_COUNT = 10;

export interface BuiltinTopic {
  title: string;
  words: string[];
}

// ChatGPT CPUへ渡すための英語の基準語彙。表示側の5言語データとは
// インデックスが完全に一致する。モデルはこのデータを自分の会話内で
// 推理し、MCPツール経由で最終アクションだけをゲームへ返す。
export const BUILTIN_TOPICS_EN: BuiltinTopic[] = [
  { title: "Animals", words: ["Lion", "Panda", "Elephant", "Giraffe", "Penguin", "Dolphin", "Koala", "Rabbit", "Hippo", "Owl", "Gorilla", "Cat", "Dog", "Hamster", "Crocodile", "Turtle"] },
  { title: "Food", words: ["Pizza", "Sushi", "Hamburger", "Ramen", "Curry", "Tacos", "Pasta", "Fried chicken", "Sandwich", "Steak", "Salad", "Ice cream", "Dumplings", "Pancakes", "Hot dog", "Fried rice"] },
  { title: "Sports", words: ["Soccer", "Baseball", "Basketball", "Tennis", "Table tennis", "Swimming", "Marathon", "Skiing", "Boxing", "Golf", "Volleyball", "Rugby", "Judo", "Gymnastics", "Skateboarding", "Surfing"] },
  { title: "Jobs", words: ["Doctor", "Teacher", "Police officer", "Pilot", "Chef", "Programmer", "Firefighter", "Hairdresser", "Lawyer", "Farmer", "Singer", "Astronaut", "Carpenter", "Nurse", "Actor", "Driver"] },
  { title: "Things at Home", words: ["Fridge", "TV", "Sofa", "Microwave", "Washing machine", "Vacuum", "Bed", "Air conditioner", "Mirror", "Bookshelf", "Curtains", "Table", "Hair dryer", "Clock", "House plant", "Lamp"] },
  { title: "Fruits", words: ["Apple", "Banana", "Strawberry", "Grapes", "Orange", "Watermelon", "Melon", "Peach", "Pineapple", "Kiwi", "Cherry", "Lemon", "Mango", "Pear", "Coconut", "Blueberry"] },
  { title: "Instruments", words: ["Piano", "Guitar", "Violin", "Drums", "Flute", "Trumpet", "Saxophone", "Harmonica", "Ukulele", "Cello", "Harp", "Recorder", "Bass", "Organ", "Accordion", "Xylophone"] },
  { title: "Vehicles", words: ["Train", "Airplane", "Bicycle", "Bus", "Taxi", "Ship", "Helicopter", "Motorcycle", "Tram", "Rocket", "Hot air balloon", "Submarine", "Fire truck", "Ambulance", "Truck", "Cable car"] },
  { title: "School", words: ["Blackboard", "Desk", "Gym", "Pool", "Library", "Playground", "Homework", "Exam", "Backpack", "Pencil", "Eraser", "Notebook", "School bell", "Uniform", "School lunch", "Classroom"] },
  { title: "Countries", words: ["Japan", "USA", "France", "Italy", "Brazil", "Egypt", "India", "Australia", "Canada", "Germany", "Spain", "China", "Mexico", "Russia", "UK", "South Korea"] },
];

export function getBuiltinTopic(index: number): BuiltinTopic {
  return BUILTIN_TOPICS_EN[index] ?? BUILTIN_TOPICS_EN[0];
}
