// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const chemGuide = String.raw`Chemistry, in one of three forms.
Formula text (prefer this unless a drawn structure is asked for): elements with _ for subscripts and ^ for charges, + between species, and the arrows -> <=> <->. Also inline: {Chem: H_2O}.
A structure, in the app's own one-line syntax (the drawing tool usually writes it): atoms (C, O, NH_2), each bond with its direction in degrees counter-clockwise from the right (-0 a single bond to the right, =90 a double bond up, #0 triple, <30 a wedge, <:30 a hash), branches in ( ), a bare bond after a bond for a carbon of the skeleton, rings closed with &1 and -&1, a name with @ (C@c), a charge with ^ (O^-), lone pairs with : (O:3). Hydrogens are added by themselves.
chemfig pasted from LaTeX (\chemfig{...}) is drawn as it is.
Keep a structure that is already in the note exactly as it is unless asked to change it.

<example>
Chem: 2H_2 + O_2 -> 2H_2O

Chem: CH_3COOH + H_2O <=> CH_3COO^- + H_3O^+

Chem: &1 =30 -330 =270 -210 =150 -&1

Chem: C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br
</example>`;
