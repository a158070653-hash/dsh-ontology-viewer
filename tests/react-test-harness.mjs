// Minimal deterministic React hook harness for UI state contract tests.
export function createReactHarness() {
  let hooks = []
  let cursor = 0
  let effects = []
  const render = (component, props = {}) => {
    cursor = 0
    effects = []
    const tree = component(props)
    for (const effect of effects) effect()
    return tree
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const setter = value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }
      return [hooks[index], setter]
    },
    useMemo(factory) { cursor++; return factory() },
    useEffect(effect) { cursor++; effects.push(effect) },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
  }
  return { React, render }
}

export function flattenReactTree(tree, result = []) {
  if (Array.isArray(tree)) {
    for (const child of tree) flattenReactTree(child, result)
  } else if (tree && typeof tree === 'object') {
    result.push(tree)
    if (tree.children) flattenReactTree(tree.children, result)
  }
  return result
}
