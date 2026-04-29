import ast
import operator
from typing import Any

from app.tools.base import Tool

# Whitelist: only these AST node types are allowed in an expression.
# Anything else (Name, Call, Attribute, Subscript, ...) is rejected, which
# is what makes this safe — no function calls, no variable lookups, no
# attribute access, so there's no path to arbitrary code execution.
_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        return _BIN_OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_eval_node(node.operand))
    raise ValueError(f"disallowed expression node: {type(node).__name__}")


async def _execute(args: dict[str, Any]) -> dict[str, Any]:
    expression = args["expression"]
    try:
        tree = ast.parse(expression, mode="eval")
        result = _eval_node(tree)
    except (SyntaxError, ValueError, ZeroDivisionError) as e:
        return {"error": f"could not evaluate '{expression}': {e}"}
    return {"expression": expression, "result": result}


tool = Tool(
    name="calculator",
    description=(
        "Evaluate a numeric expression. Supports + - * / // % ** and "
        "parentheses. No variables, no functions — pure arithmetic only."
    ),
    schema={
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Arithmetic expression, e.g. '(125000000 / 13960000) * 100'.",
            },
        },
        "required": ["expression"],
    },
    execute=_execute,
)
