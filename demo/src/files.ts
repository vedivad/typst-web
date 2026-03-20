export const files: Record<string, string> = {
  "/main.typ": `\
#import "template.typ": greet

#greet("World")

= Introduction

This demo shows *multi-file* compilation.
Each file is editable — switch tabs to see both.
`,
  "/template.typ": `\
#let greet(name) = {
  align(center, text(24pt, weight: "bold")[
    Hello, #name!
  ])
}
`,
};
