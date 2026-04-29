from typing import Any, Literal, Union

from pydantic import BaseModel


class Thought(BaseModel):
    type: Literal["thought"] = "thought"
    text: str


class ToolCall(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    name: str
    args: dict[str, Any]


class ToolResult(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    name: str
    result: Any


class FinalAnswer(BaseModel):
    type: Literal["final_answer"] = "final_answer"
    text: str


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


AgentEvent = Union[Thought, ToolCall, ToolResult, FinalAnswer, ErrorEvent]
