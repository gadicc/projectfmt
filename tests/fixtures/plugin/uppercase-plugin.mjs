export const languages = [
  { name: "Uppercase", parsers: ["uppercase"], extensions: [".upper"] },
];

export const parsers = {
  uppercase: {
    parse: (text) => ({ text }),
    astFormat: "uppercase-ast",
    locStart: () => 0,
    locEnd: (node) => node.text.length,
  },
};

export const printers = {
  "uppercase-ast": {
    print: (path) => path.node.text.trim().toUpperCase() + "\n",
  },
};
