package ast

// import "encoding/json"

//go:generate sh -c "./md2go es5.md > astnodes.go"

type Statement statement
type Statements []statement
type statement interface {
	_is_statement()
}

func (statementStuff) _is_statement() {}

type Expression expression
type Expressions []expression
type expression interface {
	_is_expression()
}

func (expressionStuff) _is_expression() {}

type DeclOrId declOrId
type declOrId interface {
	_is_declOrId()
}

func (VariableDeclaration) _is_declOrID() {}
func (Identifier) _is_declOrID()          {}

type LitOrId litOrId
type litOrId interface {
	_is_litOrId()
}

func (Literal) _is_litOrId()    {}
func (Identifier) _is_litOrId() {}